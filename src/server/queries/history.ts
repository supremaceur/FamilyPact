import 'server-only';

import { z } from 'zod';
import { AuditAction, ParentPermission } from '@/generated/prisma/enums';
import { hasCapability, type FamilyActor } from '@/server/auth/context';
import { forbiddenError } from '@/domain/errors';
import { prisma } from '@/server/db/prisma';

/**
 * Historique familial et journal d'audit.
 *
 * L'historique est PAGINE par curseur : un historique de plusieurs annees ne
 * doit jamais etre charge d'un bloc.
 */

export const HISTORY_PAGE_SIZE = 40;

export const historyFilterSchema = z.object({
  childMembershipId: z.uuid().nullable().default(null),
  actorMembershipId: z.uuid().nullable().default(null),
  action: z.enum(AuditAction).nullable().default(null),
  from: z.iso.datetime().nullable().default(null),
  to: z.iso.datetime().nullable().default(null),
  cursor: z.string().nullable().default(null),
});

export type HistoryFilter = z.infer<typeof historyFilterSchema>;

export interface HistoryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** Journal d'audit familial, filtre et pagine. */
export const getAuditHistory = async (actor: FamilyActor, filter: HistoryFilter) => {
  if (!hasCapability(actor, ParentPermission.AUDIT_VIEW)) {
    throw forbiddenError("Vous n'avez pas acces au journal d'audit.");
  }
  const parsed = historyFilterSchema.parse(filter);

  const entries = await prisma.auditLog.findMany({
    where: {
      familyId: actor.familyId,
      ...(parsed.action !== null ? { action: parsed.action } : {}),
      ...(parsed.actorMembershipId !== null ? { actorMembershipId: parsed.actorMembershipId } : {}),
      ...(parsed.from !== null || parsed.to !== null
        ? {
            createdAt: {
              ...(parsed.from !== null ? { gte: new Date(parsed.from) } : {}),
              ...(parsed.to !== null ? { lte: new Date(parsed.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_PAGE_SIZE + 1,
    ...(parsed.cursor !== null ? { cursor: { id: parsed.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      summary: true,
      createdAt: true,
      actorLabel: true,
      targetType: true,
      targetId: true,
      metadata: true,
    },
  });

  const hasMore = entries.length > HISTORY_PAGE_SIZE;
  const items = hasMore ? entries.slice(0, HISTORY_PAGE_SIZE) : entries;
  return {
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
};

export const ledgerFilterSchema = z.object({
  childMembershipId: z.uuid().nullable().default(null),
  cursor: z.string().nullable().default(null),
});

/**
 * Mouvements de points, avec l'auteur de chaque decision et le lien vers la
 * transaction annulee le cas echeant.
 */
export const getLedgerHistory = async (
  actor: FamilyActor,
  filter: z.infer<typeof ledgerFilterSchema>,
) => {
  const parsed = ledgerFilterSchema.parse(filter);

  // Un enfant ne consulte que son propre historique, quel que soit le filtre.
  const childScope =
    actor.role === 'CHILD' ? actor.membershipId : (parsed.childMembershipId ?? undefined);

  const transactions = await prisma.pointTransaction.findMany({
    where: {
      familyId: actor.familyId,
      ...(childScope !== undefined ? { childMembershipId: childScope } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_PAGE_SIZE + 1,
    ...(parsed.cursor !== null ? { cursor: { id: parsed.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      delta: true,
      type: true,
      label: true,
      reason: true,
      createdAt: true,
      effectiveAt: true,
      reversesTransactionId: true,
      childMembershipId: true,
      child: { select: { user: { select: { displayName: true } } } },
      approvedBy: { select: { user: { select: { displayName: true } } } },
      reversedBy: { select: { id: true } },
    },
  });

  const hasMore = transactions.length > HISTORY_PAGE_SIZE;
  const items = hasMore ? transactions.slice(0, HISTORY_PAGE_SIZE) : transactions;
  return {
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
};

export const getNotifications = async (actor: FamilyActor, onlyUnread = false) =>
  prisma.notification.findMany({
    where: {
      familyId: actor.familyId,
      recipientMembershipId: actor.membershipId,
      ...(onlyUnread ? { readAt: null } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      linkPath: true,
      readAt: true,
      createdAt: true,
    },
  });

export const countUnreadNotifications = async (actor: FamilyActor): Promise<number> =>
  prisma.notification.count({
    where: {
      familyId: actor.familyId,
      recipientMembershipId: actor.membershipId,
      readAt: null,
    },
  });

export const markNotificationsRead = async (
  actor: FamilyActor,
  notificationIds: readonly string[],
): Promise<number> => {
  const result = await prisma.notification.updateMany({
    where: {
      familyId: actor.familyId,
      recipientMembershipId: actor.membershipId,
      ...(notificationIds.length > 0 ? { id: { in: [...notificationIds] } } : {}),
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return result.count;
};
