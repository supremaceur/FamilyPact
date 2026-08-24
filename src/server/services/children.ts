import 'server-only';

import { z } from 'zod';
import { AuditAction, FamilyRole, ParentPermission } from '@/generated/prisma/enums';
import { notFoundError } from '@/domain/errors';
import { recordAudit } from '@/server/audit/audit-log';
import { getRequestContext, requireCapability, type FamilyActor } from '@/server/auth/context';
import { revokeAllSessionsForUser } from '@/server/auth/session';
import { prisma } from '@/server/db/prisma';

/**
 * Profils enfants.
 *
 * Collecte minimale (docs/privacy.md) : prenom ou pseudonyme, avatar choisi
 * parmi un jeu d'illustrations embarquees, couleur. Aucun televersement, donc
 * aucune photo d'enfant stockee. Ni adresse, ni ecole, ni telephone, ni
 * localisation : ces champs n'existent pas dans le schema.
 */

/** Avatars embarques : un identifiant, pas un fichier televerse. */
export const AVATAR_KEYS = [
  'fox',
  'owl',
  'otter',
  'hedgehog',
  'whale',
  'cat',
  'panda',
  'bear',
] as const;

export const COLOR_KEYS = ['sage', 'lagoon', 'amber', 'clay', 'lilac', 'slate'] as const;

export const childProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'Le prenom est obligatoire.').max(40),
  avatarKey: z.enum(AVATAR_KEYS),
  colorKey: z.enum(COLOR_KEYS),
});

export type ChildProfileInput = z.infer<typeof childProfileSchema>;

export const updateChildProfile = async (
  actor: FamilyActor,
  childMembershipId: string,
  input: ChildProfileInput,
): Promise<void> => {
  requireCapability(actor, ParentPermission.CHILD_MANAGE);
  const parsed = childProfileSchema.parse(input);
  const request = await getRequestContext();

  await prisma.$transaction(async (tx) => {
    const membership = await tx.familyMembership.findFirst({
      where: { id: childMembershipId, familyId: actor.familyId, role: FamilyRole.CHILD },
      select: { id: true, userId: true, user: { select: { displayName: true } } },
    });
    if (membership === null) throw notFoundError("Cet enfant n'existe pas dans votre famille.");

    await tx.user.update({
      where: { id: membership.userId },
      data: { displayName: parsed.displayName },
    });
    await tx.childProfile.update({
      where: { membershipId: membership.id },
      data: { avatarKey: parsed.avatarKey, colorKey: parsed.colorKey },
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.CHILD_UPDATED,
      summary: `${actor.displayName} met a jour le profil de ${parsed.displayName}.`,
      targetType: 'FamilyMembership',
      targetId: membership.id,
      metadata: { childMembershipId: membership.id, childName: parsed.displayName },
      request,
    });
  });
};

export const childDeletionSchema = z.object({
  confirmationName: z.string().trim().min(1),
});

/**
 * Supprime definitivement un enfant et toutes ses donnees.
 *
 * Effacement REEL : taches, occurrences, transactions, recompenses, sanctions et
 * notifications de cet enfant disparaissent, ainsi que son compte. Seules
 * subsistent les entrees d'audit, qui ne portent que le prenom deja publie dans
 * la famille — c'est le minimum necessaire pour que l'historique des decisions
 * parentales reste coherent.
 */
export const deleteChild = async (
  actor: FamilyActor,
  childMembershipId: string,
  input: z.infer<typeof childDeletionSchema>,
): Promise<void> => {
  requireCapability(actor, ParentPermission.CHILD_MANAGE);
  const parsed = childDeletionSchema.parse(input);
  const request = await getRequestContext();

  const membership = await prisma.familyMembership.findFirst({
    where: { id: childMembershipId, familyId: actor.familyId, role: FamilyRole.CHILD },
    select: { id: true, userId: true, user: { select: { displayName: true } } },
  });
  if (membership === null) throw notFoundError("Cet enfant n'existe pas dans votre famille.");

  if (parsed.confirmationName.trim() !== membership.user.displayName) {
    throw notFoundError('Le prenom saisi ne correspond pas.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL familipact.purge = 'on'`);
    // L'audit est ecrit AVANT la suppression : la cle etrangere vers l'adhesion
    // est en SET NULL, l'entree survit donc a l'effacement.
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.CHILD_DELETED,
      summary: `${actor.displayName} supprime definitivement le profil de ${membership.user.displayName} et toutes ses donnees.`,
      targetType: 'FamilyMembership',
      targetId: membership.id,
      metadata: { childName: membership.user.displayName },
      request,
    });

    // La suppression du compte entraine en cascade celle de l'adhesion, du
    // profil et de toutes les donnees metier rattachees.
    await tx.user.delete({ where: { id: membership.userId } });
  });

  await revokeAllSessionsForUser(prisma, membership.userId, 'child_deleted');
};

export const listChildren = async (actor: FamilyActor) =>
  prisma.familyMembership.findMany({
    where: { familyId: actor.familyId, role: FamilyRole.CHILD, status: 'ACTIVE' },
    orderBy: { joinedAt: 'asc' },
    select: {
      id: true,
      user: { select: { id: true, displayName: true, loginId: true } },
      childProfile: {
        select: { avatarKey: true, colorKey: true, cachedBalance: true, transactionCount: true },
      },
    },
  });
