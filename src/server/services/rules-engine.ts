import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import {
  AuditAction,
  NotificationKind,
  ParentPermission,
  RewardRuleStatus,
  SanctionInstanceStatus,
  SanctionRuleStatus,
} from '@/generated/prisma/enums';
import { evaluate, type EvaluationInput } from '@/domain/rules-engine';
import { recordAudit } from '@/server/audit/audit-log';
import type { Db } from '@/server/db/prisma';
import { notifyCapableParents } from '@/server/notifications/notify';

/**
 * Passerelle entre le moteur de regles (pur) et la persistance.
 *
 * Cette fonction est appelee apres CHAQUE variation de score, et par les jobs
 * planifies pour les conditions temporelles. Elle est idempotente : la rejouer
 * ne cree pas de doublon, grace aux contraintes uniques
 * `RewardEvent(rewardRuleId, childMembershipId)` et
 * `sanction_single_open_instance`.
 *
 * Elle ne prend AUCUNE decision : elle ne fait que materialiser des propositions
 * en attente de validation parentale.
 */

const UNIQUE_VIOLATION = 'P2002';

export interface EvaluationOutcome {
  readonly rewardProposalsCreated: number;
  readonly sanctionProposalsCreated: number;
  readonly liftEligibilitiesRaised: number;
}

export const evaluateChildRules = async (
  tx: Db,
  params: {
    readonly familyId: string;
    readonly childMembershipId: string;
    readonly childName: string;
    readonly score: number;
    readonly now?: Date;
  },
): Promise<EvaluationOutcome> => {
  const now = params.now ?? new Date();

  const [rewardRules, sanctionRules, activeSanctions] = await Promise.all([
    tx.rewardRule.findMany({
      where: { familyId: params.familyId, childMembershipId: params.childMembershipId },
      select: {
        id: true,
        threshold: true,
        title: true,
        status: true,
        events: { select: { id: true }, take: 1 },
      },
    }),
    tx.sanctionRule.findMany({
      where: { familyId: params.familyId, childMembershipId: params.childMembershipId },
      select: {
        id: true,
        threshold: true,
        comparator: true,
        title: true,
        description: true,
        status: true,
        armed: true,
        instances: {
          where: {
            status: {
              in: [
                SanctionInstanceStatus.PROPOSED,
                SanctionInstanceStatus.ACTIVE,
                SanctionInstanceStatus.LIFT_ELIGIBLE,
              ],
            },
          },
          select: { id: true },
          take: 1,
        },
      },
    }),
    tx.sanctionInstance.findMany({
      where: {
        familyId: params.familyId,
        childMembershipId: params.childMembershipId,
        status: SanctionInstanceStatus.ACTIVE,
      },
      select: {
        id: true,
        status: true,
        liftConditionType: true,
        liftAt: true,
        liftScoreThreshold: true,
      },
    }),
  ]);

  const input: EvaluationInput = {
    score: params.score,
    now,
    rewardRules: rewardRules.map((rule) => ({
      id: rule.id,
      threshold: rule.threshold,
      title: rule.title,
      status: rule.status,
      hasEvent: rule.events.length > 0,
    })),
    sanctionRules: sanctionRules.map((rule) => ({
      id: rule.id,
      threshold: rule.threshold,
      comparator: rule.comparator,
      title: rule.title,
      description: rule.description,
      status: rule.status,
      armed: rule.armed,
      hasOpenInstance: rule.instances.length > 0,
    })),
    activeSanctions,
  };

  const result = evaluate(input);

  let rewardProposalsCreated = 0;
  let sanctionProposalsCreated = 0;
  let liftEligibilitiesRaised = 0;

  for (const intent of result.rewardProposals) {
    try {
      const event = await tx.rewardEvent.create({
        data: {
          familyId: params.familyId,
          rewardRuleId: intent.rewardRuleId,
          childMembershipId: params.childMembershipId,
          titleSnapshot: intent.title,
          thresholdSnapshot: intent.threshold,
          scoreAtProposal: intent.scoreAtProposal,
          proposedAt: now,
        },
        select: { id: true },
      });
      rewardProposalsCreated += 1;

      await recordAudit(tx, {
        familyId: params.familyId,
        action: AuditAction.REWARD_PROPOSED,
        summary: `Palier atteint : « ${intent.title} » pour ${params.childName} (${intent.scoreAtProposal} points).`,
        targetType: 'RewardEvent',
        targetId: event.id,
        metadata: {
          rewardRuleId: intent.rewardRuleId,
          rewardEventId: event.id,
          childMembershipId: params.childMembershipId,
          childName: params.childName,
          threshold: intent.threshold,
          score: intent.scoreAtProposal,
        },
      });

      await notifyCapableParents(tx, {
        familyId: params.familyId,
        capability: ParentPermission.REWARD_APPROVE,
        dedupeKeyPrefix: `reward-proposed:${event.id}`,
        draft: {
          kind: NotificationKind.REWARD_PROPOSED,
          title: 'Une recompense peut etre validee',
          body: `${params.childName} a atteint ${intent.threshold} points : « ${intent.title} ».`,
          linkPath: '/parent/recompenses',
        },
      });
    } catch (error) {
      // La recompense a deja ete proposee : rien a faire, la contrainte unique
      // a fait son travail.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  for (const change of result.armingChanges) {
    await tx.sanctionRule.update({
      where: { id: change.sanctionRuleId },
      data: { armed: change.armed },
    });
  }

  for (const intent of result.sanctionProposals) {
    try {
      const instance = await tx.sanctionInstance.create({
        data: {
          familyId: params.familyId,
          sanctionRuleId: intent.sanctionRuleId,
          childMembershipId: params.childMembershipId,
          status: SanctionInstanceStatus.PROPOSED,
          titleSnapshot: intent.title,
          descriptionSnapshot: intent.description,
          thresholdSnapshot: intent.threshold,
          comparatorSnapshot: intent.comparator,
          scoreAtProposal: intent.scoreAtProposal,
          proposedAt: now,
        },
        select: { id: true },
      });
      sanctionProposalsCreated += 1;

      await recordAudit(tx, {
        familyId: params.familyId,
        action: AuditAction.SANCTION_PROPOSED,
        summary: `Seuil franchi : sanction « ${intent.title} » proposee pour ${params.childName} (${intent.scoreAtProposal} points).`,
        targetType: 'SanctionInstance',
        targetId: instance.id,
        metadata: {
          sanctionRuleId: intent.sanctionRuleId,
          sanctionInstanceId: instance.id,
          childMembershipId: params.childMembershipId,
          childName: params.childName,
          threshold: intent.threshold,
          score: intent.scoreAtProposal,
        },
      });

      await notifyCapableParents(tx, {
        familyId: params.familyId,
        capability: ParentPermission.SANCTION_ACTIVATE,
        dedupeKeyPrefix: `sanction-proposed:${instance.id}`,
        draft: {
          kind: NotificationKind.SANCTION_PROPOSED,
          title: 'Une sanction peut etre proposee',
          body: `${params.childName} est passe sous ${intent.threshold} points : « ${intent.title} ».`,
          linkPath: '/parent/sanctions',
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  for (const intent of result.liftEligibilities) {
    // La mise a jour conditionnelle rend l'operation idempotente : une seconde
    // execution ne trouve plus l'instance en statut ACTIVE.
    const updated = await tx.sanctionInstance.updateMany({
      where: { id: intent.sanctionInstanceId, status: SanctionInstanceStatus.ACTIVE },
      data: { status: SanctionInstanceStatus.LIFT_ELIGIBLE, liftEligibleAt: now },
    });
    if (updated.count === 0) continue;
    liftEligibilitiesRaised += 1;

    const instance = await tx.sanctionInstance.findUnique({
      where: { id: intent.sanctionInstanceId },
      select: { titleSnapshot: true },
    });

    await recordAudit(tx, {
      familyId: params.familyId,
      action: AuditAction.SANCTION_LIFT_ELIGIBLE,
      summary: `Condition de levee atteinte pour « ${instance?.titleSnapshot ?? 'sanction'} » (${params.childName}). Validation parentale requise.`,
      targetType: 'SanctionInstance',
      targetId: intent.sanctionInstanceId,
      metadata: {
        sanctionInstanceId: intent.sanctionInstanceId,
        childMembershipId: params.childMembershipId,
        childName: params.childName,
        score: params.score,
      },
    });

    await notifyCapableParents(tx, {
      familyId: params.familyId,
      capability: ParentPermission.SANCTION_LIFT,
      dedupeKeyPrefix: `sanction-lift-eligible:${intent.sanctionInstanceId}`,
      draft: {
        kind: NotificationKind.SANCTION_LIFT_ELIGIBLE,
        title: 'Une sanction peut etre levee',
        body: `La condition de levee de « ${instance?.titleSnapshot ?? 'la sanction'} » est atteinte pour ${params.childName}. Votre validation est requise.`,
        linkPath: '/parent/sanctions',
      },
    });
  }

  return { rewardProposalsCreated, sanctionProposalsCreated, liftEligibilitiesRaised };
};

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;

/**
 * Une regle de sanction nait TOUJOURS armee.
 *
 * L'evaluation qui suit immediatement sa creation tranche :
 *   - score au-dessus du seuil  → rien n'est propose, la regle reste armee et
 *     attend le premier franchissement ;
 *   - score deja sous le seuil  → une proposition est produite sur-le-champ,
 *     puis la regle se desarme. Le parent vient de decrire une situation qu'il
 *     constate : il attend une reponse, pas un silence jusqu'au prochain
 *     aller-retour du score.
 *
 * Meme raisonnement lorsqu'un seuil est modifie : la regle est rearmee, et
 * l'evaluation decide.
 */
export const INITIAL_ARMED_STATE = true;

export { RewardRuleStatus, SanctionRuleStatus };
