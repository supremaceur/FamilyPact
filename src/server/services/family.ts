import 'server-only';

import { z } from 'zod';
import {
  AuditAction,
  FamilyRole,
  MembershipStatus,
  ParentPermission,
} from '@/generated/prisma/enums';
import { conflictError, notFoundError, validationError } from '@/domain/errors';
import {
  ALL_PARENT_PERMISSIONS,
  DEFAULT_PARENT_PERMISSIONS,
  OwnerCapability,
  permissionsAreConfigurable,
} from '@/domain/permissions';
import { isValidTimeZone } from '@/domain/time';
import { recordAudit } from '@/server/audit/audit-log';
import { getRequestContext, requireCapability, type FamilyActor } from '@/server/auth/context';
import { revokeAllSessionsForUser } from '@/server/auth/session';
import { prisma } from '@/server/db/prisma';

/**
 * Famille : parametres, membres, roles, permissions, propriete.
 *
 * Toutes les operations de ce module portent sur la composition de la famille.
 * Les plus lourdes de consequences (ajout d'un parent, changement de
 * permissions, transfert de propriete, suppression) sont reservees au
 * proprietaire ET exigent une re-authentification recente.
 */

export const familySettingsSchema = z.object({
  name: z.string().trim().min(1, 'Le nom de la famille est obligatoire.').max(60),
  timeZone: z.string().refine(isValidTimeZone, 'Fuseau horaire inconnu.'),
});

export type FamilySettingsInput = z.infer<typeof familySettingsSchema>;

export const updateFamilySettings = async (
  actor: FamilyActor,
  input: FamilySettingsInput,
): Promise<void> => {
  requireCapability(actor, ParentPermission.FAMILY_SETTINGS_MANAGE);
  const parsed = familySettingsSchema.parse(input);
  const request = await getRequestContext();

  await prisma.$transaction(async (tx) => {
    await tx.family.update({
      where: { id: actor.familyId },
      data: { name: parsed.name, timeZone: parsed.timeZone },
    });
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.FAMILY_SETTINGS_UPDATED,
      summary: `${actor.displayName} met a jour les parametres : « ${parsed.name} », fuseau ${parsed.timeZone}.`,
      targetType: 'Family',
      targetId: actor.familyId,
      request,
    });
  });
};

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export const permissionUpdateSchema = z.object({
  membershipId: z.uuid(),
  permissions: z.array(z.enum(ParentPermission)).max(ALL_PARENT_PERMISSIONS.length),
});

export type PermissionUpdateInput = z.infer<typeof permissionUpdateSchema>;

/**
 * Remplace l'ensemble des permissions d'un membre PARENT.
 *
 * OWNER et ADMIN derivent leurs permissions de leur role : les leurs ne sont
 * pas modifiables, ce qui evite qu'un proprietaire se retire par megarde des
 * droits qu'il est seul a detenir.
 */
export const updateParentPermissions = async (
  actor: FamilyActor,
  input: PermissionUpdateInput,
): Promise<void> => {
  requireCapability(actor, OwnerCapability.PERMISSION_MANAGE);
  const parsed = permissionUpdateSchema.parse(input);
  const request = await getRequestContext();

  await prisma.$transaction(async (tx) => {
    const membership = await tx.familyMembership.findFirst({
      where: { id: parsed.membershipId, familyId: actor.familyId },
      select: {
        id: true,
        role: true,
        user: { select: { displayName: true } },
        permissions: { select: { permission: true } },
      },
    });
    if (membership === null) throw notFoundError('Ce membre est introuvable.');
    if (!permissionsAreConfigurable(membership.role)) {
      throw validationError(
        `Les permissions d'un membre ${membership.role} decoulent de son role et ne se modifient pas individuellement.`,
      );
    }

    const before = new Set(membership.permissions.map((grant) => grant.permission));
    const after = new Set(parsed.permissions);
    const added = [...after].filter((permission) => !before.has(permission));
    const removed = [...before].filter((permission) => !after.has(permission));

    if (added.length === 0 && removed.length === 0) return;

    await tx.parentPermissionGrant.deleteMany({ where: { membershipId: membership.id } });
    if (parsed.permissions.length > 0) {
      await tx.parentPermissionGrant.createMany({
        data: parsed.permissions.map((permission) => ({
          membershipId: membership.id,
          permission,
          grantedBy: actor.membershipId,
        })),
      });
    }

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.MEMBER_PERMISSIONS_UPDATED,
      summary: `${actor.displayName} met a jour les permissions de ${membership.user.displayName}.`,
      targetType: 'FamilyMembership',
      targetId: membership.id,
      metadata: {
        membershipId: membership.id,
        permissionsAdded: added,
        permissionsRemoved: removed,
      },
      request,
    });
  });
};

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const roleChangeSchema = z.object({
  membershipId: z.uuid(),
  role: z.enum([FamilyRole.ADMIN, FamilyRole.PARENT]),
});

export const changeMemberRole = async (
  actor: FamilyActor,
  input: z.infer<typeof roleChangeSchema>,
): Promise<void> => {
  requireCapability(actor, OwnerCapability.MEMBER_MANAGE);
  const parsed = roleChangeSchema.parse(input);
  const request = await getRequestContext();

  await prisma.$transaction(async (tx) => {
    const membership = await tx.familyMembership.findFirst({
      where: { id: parsed.membershipId, familyId: actor.familyId },
      select: { id: true, role: true, user: { select: { displayName: true } } },
    });
    if (membership === null) throw notFoundError('Ce membre est introuvable.');
    if (membership.role === FamilyRole.OWNER) {
      throw conflictError(
        'Le proprietaire ne change pas de role : utilisez le transfert de propriete.',
      );
    }
    if (membership.role === FamilyRole.CHILD) {
      throw conflictError("Le role d'un enfant ne peut pas etre change en V1.");
    }
    if (membership.role === parsed.role) return;

    await tx.familyMembership.update({
      where: { id: membership.id },
      data: { role: parsed.role },
    });

    // En devenant ADMIN, les octrois individuels deviennent sans objet (le role
    // porte deja tout) ; en redevenant PARENT, on repart des permissions par defaut.
    await tx.parentPermissionGrant.deleteMany({ where: { membershipId: membership.id } });
    if (parsed.role === FamilyRole.PARENT) {
      await tx.parentPermissionGrant.createMany({
        data: DEFAULT_PARENT_PERMISSIONS.map((permission) => ({
          membershipId: membership.id,
          permission,
          grantedBy: actor.membershipId,
        })),
      });
    }

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.MEMBER_ROLE_CHANGED,
      summary: `${actor.displayName} change le role de ${membership.user.displayName} : ${membership.role} → ${parsed.role}.`,
      targetType: 'FamilyMembership',
      targetId: membership.id,
      metadata: {
        membershipId: membership.id,
        previousRole: membership.role,
        nextRole: parsed.role,
      },
      request,
    });
  });
};

// ---------------------------------------------------------------------------
// Retrait d'un membre adulte
// ---------------------------------------------------------------------------

/**
 * Retire un parent de la famille.
 *
 * L'adhesion passe en REMOVED plutot que d'etre supprimee : le ledger et
 * l'audit continuent d'indiquer QUI a valide quoi. C'est l'un des rares cas ou
 * la suppression logique est justifiee — l'integrite de l'historique prime.
 * Toutes les sessions du membre sont revoquees immediatement.
 */
export const removeMember = async (actor: FamilyActor, membershipId: string): Promise<void> => {
  requireCapability(actor, OwnerCapability.MEMBER_MANAGE);
  const request = await getRequestContext();

  const removedUserId = await prisma.$transaction(async (tx) => {
    const membership = await tx.familyMembership.findFirst({
      where: { id: membershipId, familyId: actor.familyId },
      select: {
        id: true,
        role: true,
        userId: true,
        status: true,
        user: { select: { displayName: true } },
      },
    });
    if (membership === null) throw notFoundError('Ce membre est introuvable.');
    if (membership.role === FamilyRole.OWNER) {
      throw conflictError("Le proprietaire doit d'abord transferer la propriete de la famille.");
    }
    if (membership.role === FamilyRole.CHILD) {
      throw validationError(
        'Pour retirer un enfant, utilisez la suppression de profil enfant : ses donnees doivent etre effacees.',
      );
    }
    if (membership.status === MembershipStatus.REMOVED) return null;

    await tx.familyMembership.update({
      where: { id: membership.id },
      data: { status: MembershipStatus.REMOVED, removedAt: new Date() },
    });
    await tx.parentPermissionGrant.deleteMany({ where: { membershipId: membership.id } });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.MEMBER_REMOVED,
      summary: `${actor.displayName} retire ${membership.user.displayName} de la famille.`,
      targetType: 'FamilyMembership',
      targetId: membership.id,
      metadata: { membershipId: membership.id, previousRole: membership.role },
      request,
    });

    return membership.userId;
  });

  if (removedUserId !== null) {
    await revokeAllSessionsForUser(prisma, removedUserId, 'membership_removed');
  }
};

// ---------------------------------------------------------------------------
// Transfert de propriete
// ---------------------------------------------------------------------------

/**
 * Transfere la propriete de la famille.
 *
 * L'ancien proprietaire devient ADMIN et le nouveau devient OWNER dans la MEME
 * transaction. L'index unique partiel `family_single_active_owner` garantit
 * qu'il n'existe jamais deux proprietaires actifs, meme en cas de course.
 */
export const transferOwnership = async (
  actor: FamilyActor,
  newOwnerMembershipId: string,
): Promise<void> => {
  requireCapability(actor, OwnerCapability.OWNERSHIP_TRANSFER);
  const request = await getRequestContext();

  await prisma.$transaction(async (tx) => {
    const target = await tx.familyMembership.findFirst({
      where: {
        id: newOwnerMembershipId,
        familyId: actor.familyId,
        status: MembershipStatus.ACTIVE,
      },
      select: {
        id: true,
        role: true,
        user: {
          select: {
            displayName: true,
            kind: true,
            totpCredential: { select: { confirmedAt: true } },
          },
        },
      },
    });
    if (target === null) throw notFoundError('Ce membre est introuvable.');
    if (target.role === FamilyRole.CHILD) {
      throw validationError("La propriete ne peut etre transferee qu'a un parent.");
    }
    if (target.role === FamilyRole.OWNER) return;
    if (target.user.totpCredential?.confirmedAt == null) {
      throw validationError(
        "Ce parent doit d'abord activer sa double authentification pour devenir proprietaire.",
      );
    }

    // L'ancien proprietaire est retrograde AVANT la promotion, pour ne jamais
    // violer l'unicite du proprietaire actif.
    await tx.familyMembership.update({
      where: { id: actor.membershipId },
      data: { role: FamilyRole.ADMIN },
    });
    await tx.familyMembership.update({
      where: { id: target.id },
      data: { role: FamilyRole.OWNER },
    });
    await tx.parentPermissionGrant.deleteMany({ where: { membershipId: target.id } });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.OWNERSHIP_TRANSFERRED,
      summary: `${actor.displayName} transfere la propriete de la famille a ${target.user.displayName}.`,
      targetType: 'FamilyMembership',
      targetId: target.id,
      metadata: { membershipId: target.id, previousRole: target.role, nextRole: FamilyRole.OWNER },
      request,
    });
  });
};

// ---------------------------------------------------------------------------
// Suppression de la famille (RGPD)
// ---------------------------------------------------------------------------

export const familyDeletionSchema = z.object({
  /** L'utilisateur retape le nom de la famille : garde-fou contre le clic reflexe. */
  confirmationName: z.string().trim().min(1),
});

/**
 * Efface integralement une famille et ses donnees.
 *
 * Suppression REELLE, pas logique : c'est une exigence de protection des
 * donnees, et les donnees concernent des mineurs. Le drapeau de session
 * `familipact.purge` leve temporairement la protection append-only du ledger et
 * de l'audit, uniquement dans cette transaction.
 */
export const deleteFamily = async (
  actor: FamilyActor,
  input: z.infer<typeof familyDeletionSchema>,
): Promise<void> => {
  requireCapability(actor, OwnerCapability.FAMILY_DELETE);
  const parsed = familyDeletionSchema.parse(input);

  const family = await prisma.family.findUnique({
    where: { id: actor.familyId },
    select: { name: true },
  });
  if (family === null) throw notFoundError();
  if (parsed.confirmationName.trim() !== family.name) {
    throw validationError('Le nom saisi ne correspond pas a celui de la famille.');
  }

  const memberUserIds = await prisma.familyMembership.findMany({
    where: { familyId: actor.familyId },
    select: { userId: true, role: true },
  });

  await prisma.$transaction(async (tx) => {
    // Autorise la suppression des lignes append-only pour cette transaction.
    await tx.$executeRawUnsafe(`SET LOCAL familipact.purge = 'on'`);
    await tx.family.delete({ where: { id: actor.familyId } });
  });

  // Les comptes enfants n'existent que dans cette famille : ils sont supprimes.
  // Les comptes adultes peuvent appartenir a d'autres familles : ils survivent,
  // mais leurs sessions sont revoquees.
  const childUserIds = memberUserIds
    .filter((member) => member.role === FamilyRole.CHILD)
    .map((member) => member.userId);
  if (childUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: childUserIds } } });
  }
  for (const member of memberUserIds) {
    await revokeAllSessionsForUser(prisma, member.userId, 'family_deleted');
  }

  // L'audit de la suppression ne peut pas etre rattache a la famille effacee :
  // il est conserve sans `familyId`, avec les seuls elements non identifiants.
  await recordAudit(prisma, {
    actorUserId: actor.userId,
    actorLabel: actor.displayName,
    action: AuditAction.FAMILY_DELETED,
    summary: `La famille « ${family.name} » a ete supprimee definitivement par ${actor.displayName}.`,
    targetType: 'Family',
    targetId: actor.familyId,
    request: await getRequestContext(),
  });
};

export const listMembers = async (actor: FamilyActor) =>
  prisma.familyMembership.findMany({
    where: { familyId: actor.familyId },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    select: {
      id: true,
      role: true,
      status: true,
      joinedAt: true,
      permissions: { select: { permission: true } },
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          loginId: true,
          kind: true,
          lastLoginAt: true,
          totpCredential: { select: { confirmedAt: true } },
        },
      },
      childProfile: { select: { avatarKey: true, colorKey: true, cachedBalance: true } },
    },
  });
