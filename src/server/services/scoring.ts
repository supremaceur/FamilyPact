import 'server-only';

import type { Db } from '@/server/db/prisma';
import { appendTransaction, type AppendParams, type AppendResult } from './ledger';
import { evaluateChildRules, type EvaluationOutcome } from './rules-engine';

/**
 * Ecriture au ledger PUIS reevaluation des regles, dans la meme transaction.
 *
 * L'enchainement est volontairement indissociable : un score modifie sans
 * reevaluation laisserait passer un palier de recompense ou un franchissement
 * de seuil de sanction. Regrouper les deux dans une seule transaction garantit
 * qu'un incident ne laisse jamais le systeme dans un etat a moitie a jour.
 *
 * Rappel : la reevaluation ne fait que PROPOSER. Rien n'est accorde ni active
 * sans decision explicite d'un parent.
 */
export interface ScoreChangeResult extends AppendResult {
  readonly evaluation: EvaluationOutcome | null;
}

export const applyScoreChange = async (
  tx: Db,
  params: AppendParams & { readonly childName: string; readonly now?: Date },
): Promise<ScoreChangeResult> => {
  const applied = await appendTransaction(tx, params);

  if (applied.alreadyApplied) {
    // L'ecriture existait deja : le score n'a pas bouge, aucune regle a
    // reevaluer, et surtout aucune notification en double.
    return { ...applied, evaluation: null };
  }

  const evaluation = await evaluateChildRules(tx, {
    familyId: params.familyId,
    childMembershipId: params.childMembershipId,
    childName: params.childName,
    score: applied.balanceAfter,
    now: params.now,
  });

  return { ...applied, evaluation };
};
