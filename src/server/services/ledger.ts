import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { PointTransactionSource, PointTransactionType } from '@/generated/prisma/enums';
import { conflictError, notFoundError } from '@/domain/errors';
import { assertTransactionIsValid, type ProposedTransaction } from '@/domain/points';
import type { Db } from '@/server/db/prisma';

/**
 * Ecriture au ledger de points.
 *
 * CONCURRENCE — deux parents peuvent valider la meme tache au meme instant.
 * Trois protections se cumulent :
 *
 *   1. la ligne `ChildProfile` est verrouillee (`SELECT … FOR UPDATE`), ce qui
 *      serialise les ecritures concernant un meme enfant ;
 *   2. l'index unique `(sourceType, sourceId, type)` interdit deux ecritures
 *      pour la meme occurrence, meme si le verrou etait contourne ;
 *   3. la violation d'unicite est traduite en resultat « deja credite »,
 *      idempotent, plutot qu'en erreur brutale.
 *
 * Le solde cache est mis a jour dans la MEME transaction SQL que l'insertion :
 * ledger et cache ne peuvent pas diverger.
 */

export interface AppendResult {
  readonly transactionId: string;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  /** Vrai si l'ecriture existait deja : l'appelant ne doit pas re-notifier. */
  readonly alreadyApplied: boolean;
}

export interface AppendParams extends ProposedTransaction {
  readonly familyId: string;
  readonly childMembershipId: string;
  readonly approvedByMembershipId: string | null;
  readonly effectiveAt?: Date;
  readonly idempotencyKey?: string | null;
}

/**
 * Verrouille le profil de l'enfant et rend son solde cache.
 *
 * `FOR UPDATE` bloque les transactions concurrentes portant sur le meme enfant
 * jusqu'au COMMIT : c'est ce qui rend la sequence lecture-puis-ecriture sure.
 */
const lockChildBalance = async (
  tx: Db,
  familyId: string,
  childMembershipId: string,
): Promise<{ readonly profileId: string; readonly balance: number }> => {
  const rows = await tx.$queryRaw<{ id: string; cachedBalance: number }[]>`
    SELECT p."id", p."cachedBalance"
    FROM "ChildProfile" p
    WHERE p."membershipId" = ${childMembershipId} AND p."familyId" = ${familyId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (row === undefined) {
    throw notFoundError("Cet enfant n'existe pas dans votre famille.");
  }
  return { profileId: row.id, balance: row.cachedBalance };
};

const UNIQUE_VIOLATION = 'P2002';

/**
 * Ajoute une transaction et met a jour le solde cache, atomiquement.
 * Doit etre appelee A L'INTERIEUR d'une transaction SQL.
 */
export const appendTransaction = async (tx: Db, params: AppendParams): Promise<AppendResult> => {
  assertTransactionIsValid(params);

  const locked = await lockChildBalance(tx, params.familyId, params.childMembershipId);

  try {
    const created = await tx.pointTransaction.create({
      data: {
        familyId: params.familyId,
        childMembershipId: params.childMembershipId,
        delta: params.delta,
        type: params.type,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        label: params.label,
        reason: params.reason,
        approvedById: params.approvedByMembershipId,
        reversesTransactionId: params.reversesTransactionId,
        idempotencyKey: params.idempotencyKey ?? null,
        effectiveAt: params.effectiveAt ?? new Date(),
      },
      select: { id: true },
    });

    const balanceAfter = locked.balance + params.delta;
    await tx.childProfile.update({
      where: { id: locked.profileId },
      data: {
        cachedBalance: balanceAfter,
        transactionCount: { increment: 1 },
        balanceUpdatedAt: new Date(),
      },
    });

    return {
      transactionId: created.id,
      balanceBefore: locked.balance,
      balanceAfter,
      alreadyApplied: false,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
      // Une transaction identique existe deja : c'est le cas nominal quand deux
      // parents valident simultanement. On rend le resultat existant.
      const existing = await tx.pointTransaction.findFirst({
        where: {
          familyId: params.familyId,
          childMembershipId: params.childMembershipId,
          type: params.type,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
        },
        select: { id: true },
      });
      if (existing === null) throw error;
      return {
        transactionId: existing.id,
        balanceBefore: locked.balance,
        balanceAfter: locked.balance,
        alreadyApplied: true,
      };
    }
    throw error;
  }
};

/**
 * Recalcule le solde a partir du ledger et corrige le cache si necessaire.
 *
 * Le ledger reste la source de verite : cette fonction existe pour verifier
 * l'invariant en test et pour reparer un cache abime par un incident.
 */
export const recomputeBalance = async (
  db: Db,
  familyId: string,
  childMembershipId: string,
): Promise<{ readonly ledgerBalance: number; readonly cachedBalance: number }> => {
  const aggregate = await db.pointTransaction.aggregate({
    where: { familyId, childMembershipId },
    _sum: { delta: true },
    _count: true,
  });
  const ledgerBalance = aggregate._sum.delta ?? 0;

  const profile = await db.childProfile.findUnique({
    where: { membershipId: childMembershipId },
    select: { id: true, cachedBalance: true },
  });
  if (profile === null) throw notFoundError();

  if (profile.cachedBalance !== ledgerBalance) {
    await db.childProfile.update({
      where: { id: profile.id },
      data: {
        cachedBalance: ledgerBalance,
        transactionCount: aggregate._count,
        balanceUpdatedAt: new Date(),
      },
    });
  }

  return { ledgerBalance, cachedBalance: profile.cachedBalance };
};

/** Solde courant, lu depuis le cache (toujours egal au ledger par construction). */
export const getBalance = async (
  db: Db,
  familyId: string,
  childMembershipId: string,
): Promise<number> => {
  const profile = await db.childProfile.findFirst({
    where: { membershipId: childMembershipId, familyId },
    select: { cachedBalance: true },
  });
  if (profile === null) throw notFoundError("Cet enfant n'existe pas dans votre famille.");
  return profile.cachedBalance;
};

/**
 * Annule une transaction par une ecriture inverse.
 * L'originale n'est jamais modifiee : les deux lignes restent visibles.
 */
export const reverseTransaction = async (
  tx: Db,
  params: {
    readonly familyId: string;
    readonly transactionId: string;
    readonly reason: string;
    readonly approvedByMembershipId: string;
  },
): Promise<AppendResult> => {
  const original = await tx.pointTransaction.findFirst({
    where: { id: params.transactionId, familyId: params.familyId },
    select: {
      id: true,
      delta: true,
      label: true,
      type: true,
      childMembershipId: true,
      reversedBy: { select: { id: true } },
    },
  });
  if (original === null) throw notFoundError('Cette transaction est introuvable.');
  if (original.reversedBy !== null) {
    throw conflictError('Cette transaction a deja ete annulee.');
  }
  if (original.type === PointTransactionType.REVERSAL) {
    throw conflictError(
      'Une annulation ne peut pas etre annulee. Effectuez un nouvel ajustement manuel.',
    );
  }

  return appendTransaction(tx, {
    familyId: params.familyId,
    childMembershipId: original.childMembershipId,
    delta: -original.delta,
    type: PointTransactionType.REVERSAL,
    sourceType: PointTransactionSource.REVERSAL,
    sourceId: original.id,
    label: `Annulation — ${original.label}`,
    reason: params.reason,
    reversesTransactionId: original.id,
    approvedByMembershipId: params.approvedByMembershipId,
  });
};
