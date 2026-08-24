import 'server-only';

import { z } from 'zod';
import {
  AuditAction,
  NotificationKind,
  ParentPermission,
  PointTransactionSource,
  PointTransactionType,
} from '@/generated/prisma/enums';
import { notFoundError } from '@/domain/errors';
import { MAX_TRANSACTION_DELTA } from '@/domain/points';
import { recordAudit } from '@/server/audit/audit-log';
import { requireCapability, type FamilyActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';
import { notify } from '@/server/notifications/notify';
import { reverseTransaction } from './ledger';
import { applyScoreChange } from './scoring';
import { evaluateChildRules } from './rules-engine';

/**
 * Corrections manuelles du ledger.
 *
 * Deux operations, toutes deux tracees et toutes deux exigeant un motif :
 *   - AJUSTEMENT : ajoute une ligne au ledger, sans toucher au passe ;
 *   - ANNULATION : ajoute la ligne inverse d'une transaction existante.
 *
 * Aucune transaction anterieure n'est jamais modifiee. L'historique montre
 * l'erreur ET sa correction, avec auteur, date et motif.
 */

export const adjustmentInputSchema = z.object({
  childMembershipId: z.uuid(),
  delta: z
    .int()
    .refine((value) => value !== 0, "Un ajustement de 0 point n'a aucun effet.")
    .refine(
      (value) => Math.abs(value) <= MAX_TRANSACTION_DELTA,
      `Le mouvement ne peut pas depasser ${MAX_TRANSACTION_DELTA} points.`,
    ),
  reason: z.string().trim().min(3, 'Le motif est obligatoire.').max(500),
  /** Cle d'idempotence facultative, pour neutraliser un double envoi. */
  idempotencyKey: z.string().trim().min(8).max(128).nullable().default(null),
});

export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;

export interface AdjustmentResult {
  readonly transactionId: string;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}

export const adjustPoints = async (
  actor: FamilyActor,
  input: AdjustmentInput,
): Promise<AdjustmentResult> => {
  requireCapability(actor, ParentPermission.POINTS_ADJUST);
  const parsed = adjustmentInputSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const child = await tx.familyMembership.findFirst({
      where: {
        id: parsed.childMembershipId,
        familyId: actor.familyId,
        role: 'CHILD',
        status: 'ACTIVE',
      },
      select: { user: { select: { displayName: true } } },
    });
    if (child === null) throw notFoundError("Cet enfant n'existe pas dans votre famille.");

    const applied = await applyScoreChange(tx, {
      familyId: actor.familyId,
      childMembershipId: parsed.childMembershipId,
      childName: child.user.displayName,
      delta: parsed.delta,
      type: PointTransactionType.MANUAL_ADJUSTMENT,
      sourceType: PointTransactionSource.MANUAL,
      sourceId: null,
      label: 'Ajustement manuel',
      reason: parsed.reason,
      reversesTransactionId: null,
      approvedByMembershipId: actor.membershipId,
      idempotencyKey: parsed.idempotencyKey,
    });

    const sign = parsed.delta > 0 ? '+' : '';
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.POINTS_ADJUSTED,
      summary: `${actor.displayName} ajuste le score de ${child.user.displayName} de ${sign}${parsed.delta} point(s). Motif : ${parsed.reason}`,
      targetType: 'PointTransaction',
      targetId: applied.transactionId,
      metadata: {
        transactionId: applied.transactionId,
        childMembershipId: parsed.childMembershipId,
        childName: child.user.displayName,
        delta: parsed.delta,
        balanceBefore: applied.balanceBefore,
        balanceAfter: applied.balanceAfter,
        reason: parsed.reason,
      },
    });

    if (!applied.alreadyApplied) {
      await notify(tx, {
        familyId: actor.familyId,
        recipientMembershipId: parsed.childMembershipId,
        kind: NotificationKind.POINTS_ADJUSTED,
        title: 'Ton score a ete ajuste',
        body: `${actor.displayName} a ajuste ton score de ${sign}${parsed.delta} point(s). Motif : ${parsed.reason}`,
        linkPath: '/enfant/points',
      });
    }

    return {
      transactionId: applied.transactionId,
      balanceBefore: applied.balanceBefore,
      balanceAfter: applied.balanceAfter,
    };
  });
};

export const reversalInputSchema = z.object({
  transactionId: z.uuid(),
  reason: z.string().trim().min(3, 'Le motif est obligatoire.').max(500),
});

export type ReversalInput = z.infer<typeof reversalInputSchema>;

export const reversePointTransaction = async (
  actor: FamilyActor,
  input: ReversalInput,
): Promise<AdjustmentResult> => {
  requireCapability(actor, ParentPermission.POINTS_ADJUST);
  const parsed = reversalInputSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const original = await tx.pointTransaction.findFirst({
      where: { id: parsed.transactionId, familyId: actor.familyId },
      select: {
        id: true,
        delta: true,
        label: true,
        childMembershipId: true,
        child: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (original === null) throw notFoundError('Cette transaction est introuvable.');

    const applied = await reverseTransaction(tx, {
      familyId: actor.familyId,
      transactionId: parsed.transactionId,
      reason: parsed.reason,
      approvedByMembershipId: actor.membershipId,
    });

    const childName = original.child.user.displayName;
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.POINTS_REVERSED,
      summary: `${actor.displayName} annule « ${original.label} » (${original.delta > 0 ? '+' : ''}${original.delta}) pour ${childName}. Motif : ${parsed.reason}`,
      targetType: 'PointTransaction',
      targetId: applied.transactionId,
      metadata: {
        transactionId: applied.transactionId,
        reversedTransactionId: original.id,
        childMembershipId: original.childMembershipId,
        childName,
        delta: -original.delta,
        balanceBefore: applied.balanceBefore,
        balanceAfter: applied.balanceAfter,
        reason: parsed.reason,
      },
    });

    // Le score a change : les paliers et les seuils sont reevalues.
    await evaluateChildRules(tx, {
      familyId: actor.familyId,
      childMembershipId: original.childMembershipId,
      childName,
      score: applied.balanceAfter,
    });

    await notify(tx, {
      familyId: actor.familyId,
      recipientMembershipId: original.childMembershipId,
      kind: NotificationKind.POINTS_ADJUSTED,
      title: 'Une correction a ete faite',
      body: `${actor.displayName} a annule « ${original.label} ». Motif : ${parsed.reason}`,
      linkPath: '/enfant/points',
      dedupeKey: `reversal:${applied.transactionId}`,
    });

    return {
      transactionId: applied.transactionId,
      balanceBefore: applied.balanceBefore,
      balanceAfter: applied.balanceAfter,
    };
  });
};
