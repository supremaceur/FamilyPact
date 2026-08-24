import 'server-only';

import { z } from 'zod';
import { AuditAction, ParentPermission, type PointTransactionType } from '@/generated/prisma/enums';
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

/**
 * Chronologie familiale : mouvements de points ET decisions sans effet sur les
 * points, dans un seul fil.
 *
 * POURQUOI DEUX SOURCES — le registre ne contient, par construction, que ce qui
 * a bouge. Un refus sans retrait, une echeance ignoree : ce sont de vraies
 * decisions parentales qui n'ecrivent rien au registre. Les lire uniquement la
 * rendait ces decisions invisibles, alors qu'elles sont precisement ce qu'un
 * parent vient verifier.
 *
 * QUELLES DECISIONS — seulement celles qui NE PEUVENT PAS ecrire au registre.
 * Une validation ou une echeance confirmee y figurent deja via leur mouvement
 * de points ; les reprendre depuis l'audit les afficherait deux fois.
 */
const DECISIONS_SANS_MOUVEMENT: readonly AuditAction[] = [
  AuditAction.TASK_REJECTED,
  AuditAction.TASK_MISSED_IGNORED,
  // Retirer une recompense ne touche a aucun point : sans cette ligne, la
  // decision n'apparaitrait nulle part dans l'historique de l'enfant.
  AuditAction.REWARD_REVOKED,
];

export type TimelineEntry =
  | {
      readonly kind: 'POINTS';
      readonly id: string;
      readonly at: Date;
      readonly childMembershipId: string;
      readonly childName: string;
      readonly delta: number;
      readonly type: PointTransactionType;
      readonly label: string;
      readonly reason: string | null;
      readonly actorName: string | null;
    }
  | {
      readonly kind: 'DECISION';
      readonly id: string;
      readonly at: Date;
      readonly childMembershipId: string | null;
      readonly childName: string | null;
      readonly action: AuditAction;
      readonly summary: string;
      readonly reason: string | null;
      readonly actorName: string | null;
    };

/**
 * Curseur de pagination : `<horodatage ISO>|<identifiant>`.
 *
 * Un curseur sur le seul horodatage perdrait ou dupliquerait une entree quand
 * deux evenements partagent la meme milliseconde — ce qui arrive des qu'une
 * decision ecrit simultanement au registre et a l'audit. La paire ordonnee
 * (createdAt, id) est, elle, strictement totale.
 */
const decodeCursor = (cursor: string | null): { at: Date; id: string } | null => {
  if (cursor === null) return null;
  const separateur = cursor.lastIndexOf('|');
  if (separateur <= 0) return null;
  const at = new Date(cursor.slice(0, separateur));
  const id = cursor.slice(separateur + 1);
  if (Number.isNaN(at.getTime()) || id.length === 0) return null;
  return { at, id };
};

const encodeCursor = (entry: TimelineEntry): string => `${entry.at.toISOString()}|${entry.id}`;

/** Filtre « strictement avant le curseur », au sens de l'ordre (createdAt, id). */
const avantLeCurseur = (
  position: { at: Date; id: string } | null,
): Record<string, unknown> | undefined =>
  position === null
    ? undefined
    : {
        OR: [
          { createdAt: { lt: position.at } },
          { createdAt: position.at, id: { lt: position.id } },
        ],
      };

export const getFamilyTimeline = async (
  actor: FamilyActor,
  filter: z.infer<typeof ledgerFilterSchema>,
): Promise<HistoryPage<TimelineEntry>> => {
  const parsed = ledgerFilterSchema.parse(filter);
  const position = decodeCursor(parsed.cursor);
  const borne = avantLeCurseur(position);

  // Un enfant ne consulte que sa propre chronologie, quel que soit le filtre
  // demande : la portee est decidee ici, jamais par l'appelant.
  const childScope =
    actor.role === 'CHILD' ? actor.membershipId : (parsed.childMembershipId ?? undefined);

  // Chaque source rend une page complete : apres fusion, on en garde une page.
  // Prendre moins risquerait de tronquer la source la plus dense.
  const [transactions, decisions] = await Promise.all([
    prisma.pointTransaction.findMany({
      where: {
        familyId: actor.familyId,
        ...(childScope !== undefined ? { childMembershipId: childScope } : {}),
        ...borne,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_PAGE_SIZE + 1,
      select: {
        id: true,
        delta: true,
        type: true,
        label: true,
        reason: true,
        createdAt: true,
        childMembershipId: true,
        child: { select: { user: { select: { displayName: true } } } },
        approvedBy: { select: { user: { select: { displayName: true } } } },
      },
    }),
    prisma.auditLog.findMany({
      where: {
        familyId: actor.familyId,
        action: { in: [...DECISIONS_SANS_MOUVEMENT] },
        ...(childScope !== undefined
          ? { metadata: { path: ['childMembershipId'], equals: childScope } }
          : {}),
        ...borne,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_PAGE_SIZE + 1,
      select: {
        id: true,
        action: true,
        summary: true,
        createdAt: true,
        actorLabel: true,
        metadata: true,
      },
    }),
  ]);

  const lireTexte = (metadata: unknown, cle: string): string | null => {
    if (typeof metadata !== 'object' || metadata === null) return null;
    const valeur = (metadata as Record<string, unknown>)[cle];
    return typeof valeur === 'string' && valeur.length > 0 ? valeur : null;
  };

  const fusion: TimelineEntry[] = [
    ...transactions.map((row): TimelineEntry => ({
      kind: 'POINTS',
      id: row.id,
      at: row.createdAt,
      childMembershipId: row.childMembershipId,
      childName: row.child.user.displayName,
      delta: row.delta,
      type: row.type,
      label: row.label,
      reason: row.reason,
      actorName: row.approvedBy?.user.displayName ?? null,
    })),
    ...decisions.map((row): TimelineEntry => ({
      kind: 'DECISION',
      id: row.id,
      at: row.createdAt,
      childMembershipId: lireTexte(row.metadata, 'childMembershipId'),
      childName: lireTexte(row.metadata, 'childName'),
      action: row.action,
      summary: row.summary,
      reason: lireTexte(row.metadata, 'reason'),
      actorName: row.actorLabel,
    })),
  ].sort((a, b) => {
    const ecart = b.at.getTime() - a.at.getTime();
    return ecart !== 0 ? ecart : a.id < b.id ? 1 : -1;
  });

  const hasMore = fusion.length > HISTORY_PAGE_SIZE;
  const items = hasMore ? fusion.slice(0, HISTORY_PAGE_SIZE) : fusion;
  const dernier = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && dernier !== undefined ? encodeCursor(dernier) : null,
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
