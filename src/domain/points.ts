/**
 * Ledger de points — calculs purs.
 *
 * Principe : le score d'un enfant est la somme des `delta` de ses transactions.
 * Aucune fonction de ce module ne modifie une transaction existante ; corriger
 * une erreur consiste a produire une transaction inverse.
 */

import { PointTransactionSource, PointTransactionType } from '@/generated/prisma/enums';
import { validationError } from './errors';

export { PointTransactionSource, PointTransactionType };

/** Projection minimale d'une transaction, suffisante pour les calculs. */
export interface LedgerEntry {
  readonly id: string;
  readonly delta: number;
  readonly type: PointTransactionType;
  readonly reversesTransactionId: string | null;
}

/**
 * Score officiel : somme de TOUS les deltas.
 *
 * Une annulation est elle-meme une transaction (delta oppose), donc aucune
 * ligne n'est exclue du calcul. C'est ce qui rend l'historique lisible :
 * l'erreur et sa correction restent toutes deux visibles.
 */
export const computeBalance = (entries: readonly LedgerEntry[]): number =>
  entries.reduce((total, entry) => total + entry.delta, 0);

/**
 * Le score n'est PAS borne a zero : une famille peut decider que les retraits
 * font passer un enfant en negatif. Cette fonction existe pour rendre cette
 * decision explicite et documentee plutot que subie.
 */
export const clampBalance = (balance: number): number => balance;

export interface ProposedTransaction {
  readonly delta: number;
  readonly type: PointTransactionType;
  readonly sourceType: PointTransactionSource;
  readonly sourceId: string | null;
  readonly label: string;
  readonly reason: string | null;
  readonly reversesTransactionId: string | null;
}

const REASON_REQUIRED_TYPES: ReadonlySet<PointTransactionType> = new Set([
  PointTransactionType.MANUAL_ADJUSTMENT,
  PointTransactionType.REVERSAL,
]);

/**
 * Valide une ecriture avant insertion. Double les contraintes SQL : le message
 * d'erreur reste ainsi comprehensible pour l'utilisateur, et le domaine est
 * testable sans base de donnees.
 */
export const assertTransactionIsValid = (transaction: ProposedTransaction): void => {
  if (!Number.isInteger(transaction.delta)) {
    throw validationError('Le nombre de points doit etre un entier.');
  }
  if (transaction.delta === 0) {
    throw validationError("Une transaction de 0 point n'a aucun effet.");
  }
  if (Math.abs(transaction.delta) > MAX_TRANSACTION_DELTA) {
    throw validationError(
      `Le mouvement de points ne peut pas depasser ${MAX_TRANSACTION_DELTA} points.`,
    );
  }
  if (REASON_REQUIRED_TYPES.has(transaction.type)) {
    if (!transaction.reason || transaction.reason.trim().length === 0) {
      throw validationError('Un motif est obligatoire pour cette correction.');
    }
  }
  if (
    (transaction.type === PointTransactionType.REVERSAL) !==
    (transaction.reversesTransactionId !== null)
  ) {
    throw validationError('Une annulation doit designer exactement une transaction a annuler.');
  }
};

/** Borne haute defensive : evite qu'une faute de frappe ne detruise un score. */
export const MAX_TRANSACTION_DELTA = 100_000;

/** Construit la transaction qui annule `entry`. */
export const buildReversal = (
  entry: LedgerEntry & { readonly label: string },
  reason: string,
): ProposedTransaction => {
  if (entry.type === PointTransactionType.REVERSAL) {
    throw validationError(
      'Une annulation ne peut pas etre annulee a son tour. Effectuez plutot un nouvel ajustement manuel.',
    );
  }
  const reversal: ProposedTransaction = {
    delta: -entry.delta,
    type: PointTransactionType.REVERSAL,
    sourceType: PointTransactionSource.REVERSAL,
    sourceId: entry.id,
    label: `Annulation — ${entry.label}`,
    reason,
    reversesTransactionId: entry.id,
  };
  assertTransactionIsValid(reversal);
  return reversal;
};

/**
 * Etat du score avant/apres une decision, affiche au parent AVANT confirmation
 * (« Score : 180 → 200 »).
 */
export interface BalancePreview {
  readonly before: number;
  readonly delta: number;
  readonly after: number;
}

export const previewBalance = (currentBalance: number, delta: number): BalancePreview => ({
  before: currentBalance,
  delta,
  after: currentBalance + delta,
});
