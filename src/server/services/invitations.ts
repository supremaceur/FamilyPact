import 'server-only';

import { z } from 'zod';
import { AuditAction, FamilyRole, InvitationStatus } from '@/generated/prisma/enums';
import { conflictError, forbiddenError, notFoundError, validationError } from '@/domain/errors';
import { OwnerCapability, ParentPermission } from '@/domain/permissions';
import { recordAudit } from '@/server/audit/audit-log';
import { requireCapability, type FamilyActor } from '@/server/auth/context';
import { hashLookupToken } from '@/server/crypto/hashing';
import {
  formatCodeForDisplay,
  generateHumanCode,
  normalizeHumanCode,
} from '@/server/crypto/random';
import { prisma, type Db } from '@/server/db/prisma';

/**
 * Invitations — le « code famille ».
 *
 * Un code d'invitation est un jeton a usage unique lie a UNE famille et a UN
 * role cible. Proprietes garanties :
 *   - genere cryptographiquement, 24 caracteres Crockford (~120 bits) ;
 *   - stocke uniquement sous forme de hash SHA-256 : la base compromise ne
 *     livre aucun code utilisable ;
 *   - expire ;
 *   - consommable une seule fois, la consommation etant atomique ;
 *   - revocable avant usage ;
 *   - rattache a son createur et audite.
 *
 * Un jeton CHILD ne peut JAMAIS creer un compte parent : le role est porte par
 * le jeton lui-meme, jamais par la requete du client.
 */

/** 24 caracteres sur un alphabet de 32 = 120 bits d'entropie. */
export const INVITATION_CODE_LENGTH = 24;
export const DEFAULT_INVITATION_TTL_HOURS = 72;

export const invitationInputSchema = z.object({
  targetRole: z.enum([FamilyRole.ADMIN, FamilyRole.PARENT, FamilyRole.CHILD]),
  label: z.string().trim().max(80).nullable().default(null),
  expiresInHours: z.int().min(1).max(720).default(DEFAULT_INVITATION_TTL_HOURS),
});

export type InvitationInput = z.infer<typeof invitationInputSchema>;

export interface CreatedInvitation {
  readonly id: string;
  /** Code en clair, affiche UNE SEULE fois. Jamais journalise, jamais restocke. */
  readonly code: string;
  readonly formattedCode: string;
  /** Lien direct, a encoder en QR code. */
  readonly joinUrl: string;
  readonly targetRole: FamilyRole;
  readonly expiresAt: Date;
}

export const createInvitation = async (
  actor: FamilyActor,
  input: InvitationInput,
  appOrigin: string,
): Promise<CreatedInvitation> => {
  const parsed = invitationInputSchema.parse(input);

  // Inviter un adulte modifie la composition de la famille : capacite reservee
  // au proprietaire, et soumise a une re-authentification recente.
  // Inviter un enfant releve de la gestion courante.
  if (parsed.targetRole === FamilyRole.CHILD) {
    requireCapability(actor, ParentPermission.CHILD_MANAGE);
  } else {
    requireCapability(actor, OwnerCapability.MEMBER_MANAGE);
  }

  const code = generateHumanCode(INVITATION_CODE_LENGTH);
  const expiresAt = new Date(Date.now() + parsed.expiresInHours * 3_600_000);

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: {
        familyId: actor.familyId,
        targetRole: parsed.targetRole,
        tokenHash: hashLookupToken(code),
        label: parsed.label,
        expiresAt,
        createdById: actor.membershipId,
      },
      select: { id: true },
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.INVITATION_CREATED,
      summary: `${actor.displayName} cree une invitation ${parsed.targetRole}${parsed.label !== null ? ` (« ${parsed.label} »)` : ''}, valable ${parsed.expiresInHours} h.`,
      targetType: 'Invitation',
      targetId: created.id,
      // Le code brut n'apparait NULLE PART dans l'audit.
      metadata: { invitationId: created.id, targetRole: parsed.targetRole },
    });

    return created;
  });

  return {
    id: invitation.id,
    code,
    formattedCode: formatCodeForDisplay(code),
    joinUrl: `${appOrigin.replace(/\/$/, '')}/rejoindre?code=${formatCodeForDisplay(code)}`,
    targetRole: parsed.targetRole,
    expiresAt,
  };
};

export const revokeInvitation = async (actor: FamilyActor, invitationId: string): Promise<void> => {
  await prisma.$transaction(async (tx) => {
    const invitation = await tx.invitation.findFirst({
      where: { id: invitationId, familyId: actor.familyId },
      select: { id: true, targetRole: true, status: true, label: true },
    });
    if (invitation === null) throw notFoundError('Cette invitation est introuvable.');

    if (invitation.targetRole === FamilyRole.CHILD) {
      requireCapability(actor, ParentPermission.CHILD_MANAGE);
    } else {
      requireCapability(actor, OwnerCapability.MEMBER_MANAGE);
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw conflictError('Cette invitation ne peut plus etre revoquee.');
    }

    await tx.invitation.updateMany({
      where: { id: invitationId, status: InvitationStatus.PENDING },
      data: {
        status: InvitationStatus.REVOKED,
        revokedAt: new Date(),
        revokedById: actor.membershipId,
      },
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.INVITATION_REVOKED,
      summary: `${actor.displayName} revoque une invitation ${invitation.targetRole}${invitation.label !== null ? ` (« ${invitation.label} »)` : ''}.`,
      targetType: 'Invitation',
      targetId: invitationId,
      metadata: { invitationId, targetRole: invitation.targetRole },
    });
  });
};

export interface ResolvedInvitation {
  readonly id: string;
  readonly familyId: string;
  readonly familyName: string;
  readonly targetRole: FamilyRole;
  readonly expiresAt: Date;
}

/**
 * Verifie un code SANS le consommer, pour afficher « Rejoindre la famille X ».
 *
 * Les erreurs sont volontairement indifferenciees : un code invalide, expire,
 * revoque ou deja utilise renvoient le meme message. Sinon, un attaquant
 * pourrait distinguer un code inexistant d'un code deja consomme.
 */
export const resolveInvitationCode = async (
  db: Db,
  rawCode: string,
  now: Date = new Date(),
): Promise<ResolvedInvitation> => {
  const normalized = normalizeHumanCode(rawCode);
  if (normalized.length !== INVITATION_CODE_LENGTH) {
    throw validationError('Ce code est invalide ou a deja ete utilise.');
  }

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashLookupToken(normalized) },
    select: {
      id: true,
      familyId: true,
      targetRole: true,
      status: true,
      expiresAt: true,
      family: { select: { name: true } },
    },
  });

  if (
    invitation === null ||
    invitation.status !== InvitationStatus.PENDING ||
    invitation.expiresAt.getTime() <= now.getTime()
  ) {
    throw validationError('Ce code est invalide ou a deja ete utilise.');
  }

  return {
    id: invitation.id,
    familyId: invitation.familyId,
    familyName: invitation.family.name,
    targetRole: invitation.targetRole,
    expiresAt: invitation.expiresAt,
  };
};

/**
 * Consomme un jeton, de facon ATOMIQUE.
 *
 * La mise a jour est conditionnee au statut PENDING : deux requetes concurrentes
 * portant le meme code n'en verront qu'une reussir. C'est ce qui rend le jeton
 * reellement a usage unique, meme sous course.
 *
 * A appeler A L'INTERIEUR de la transaction qui cree le compte : si la creation
 * echoue, le jeton n'est pas consomme.
 */
export const consumeInvitation = async (
  tx: Db,
  params: {
    readonly invitationId: string;
    readonly consumedByUserId: string;
    readonly expectedRole: FamilyRole;
    readonly now?: Date;
  },
): Promise<void> => {
  const now = params.now ?? new Date();

  const consumed = await tx.invitation.updateMany({
    where: {
      id: params.invitationId,
      status: InvitationStatus.PENDING,
      targetRole: params.expectedRole,
      expiresAt: { gt: now },
    },
    data: {
      status: InvitationStatus.CONSUMED,
      consumedAt: now,
      consumedByUserId: params.consumedByUserId,
    },
  });

  if (consumed.count !== 1) {
    throw validationError('Ce code est invalide ou a deja ete utilise.');
  }
};

/** Refus explicite : un jeton ne peut pas servir a obtenir un autre role. */
export const assertRoleMatches = (
  invitation: ResolvedInvitation,
  requestedRole: FamilyRole,
): void => {
  if (invitation.targetRole !== requestedRole) {
    throw forbiddenError('Ce code ne permet pas de creer ce type de compte.');
  }
};

export const listInvitations = async (actor: FamilyActor) => {
  requireCapability(actor, ParentPermission.CHILD_MANAGE);
  return prisma.invitation.findMany({
    where: { familyId: actor.familyId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      targetRole: true,
      status: true,
      label: true,
      expiresAt: true,
      createdAt: true,
      consumedAt: true,
      revokedAt: true,
      createdBy: { select: { user: { select: { displayName: true } } } },
      consumedBy: { select: { displayName: true } },
    },
  });
};
