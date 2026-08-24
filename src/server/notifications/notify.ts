import 'server-only';

import { FamilyRole, MembershipStatus, NotificationKind } from '@/generated/prisma/enums';
import { ParentPermission } from '@/generated/prisma/enums';
import { can } from '@/domain/permissions';
import type { Db } from '@/server/db/prisma';

/**
 * Centre de notifications interne.
 *
 * Les notifications sont un CONFORT, jamais un maillon de la coherence metier :
 * si l'ecriture d'une notification echoue, la decision parentale reste valide.
 * Elles sont donc creees dans la meme transaction que l'action, mais aucune
 * regle ne depend de leur presence.
 *
 * `dedupeKey` rend l'ecriture idempotente : un job rejoue ne cree pas de doublon.
 */

export interface NotificationDraft {
  readonly familyId: string;
  readonly recipientMembershipId: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly body: string;
  readonly linkPath?: string | null;
  readonly dedupeKey?: string | null;
}

export const notify = async (db: Db, draft: NotificationDraft): Promise<void> => {
  if (draft.dedupeKey != null) {
    await db.notification.upsert({
      where: { dedupeKey: draft.dedupeKey },
      create: {
        familyId: draft.familyId,
        recipientMembershipId: draft.recipientMembershipId,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        linkPath: draft.linkPath ?? null,
        dedupeKey: draft.dedupeKey,
      },
      update: {},
    });
    return;
  }

  await db.notification.create({
    data: {
      familyId: draft.familyId,
      recipientMembershipId: draft.recipientMembershipId,
      kind: draft.kind,
      title: draft.title,
      body: draft.body,
      linkPath: draft.linkPath ?? null,
    },
  });
};

/**
 * Notifie les parents concernes par une decision a prendre.
 *
 * Seuls les parents REELLEMENT habilites sont notifies : inutile d'alerter un
 * parent qui n'a pas la permission de valider la tache en question.
 */
export const notifyCapableParents = async (
  db: Db,
  params: {
    readonly familyId: string;
    readonly capability: ParentPermission;
    readonly draft: Omit<NotificationDraft, 'familyId' | 'recipientMembershipId' | 'dedupeKey'>;
    readonly dedupeKeyPrefix?: string;
  },
): Promise<void> => {
  const parents = await db.familyMembership.findMany({
    where: {
      familyId: params.familyId,
      status: MembershipStatus.ACTIVE,
      role: { in: [FamilyRole.OWNER, FamilyRole.ADMIN, FamilyRole.PARENT] },
    },
    select: { id: true, role: true, permissions: { select: { permission: true } } },
  });

  const recipients = parents.filter((parent) =>
    can(
      { role: parent.role, permissions: parent.permissions.map((grant) => grant.permission) },
      params.capability,
    ),
  );

  for (const recipient of recipients) {
    await notify(db, {
      familyId: params.familyId,
      recipientMembershipId: recipient.id,
      ...params.draft,
      dedupeKey:
        params.dedupeKeyPrefix !== undefined ? `${params.dedupeKeyPrefix}:${recipient.id}` : null,
    });
  }
};

export { NotificationKind, ParentPermission };
