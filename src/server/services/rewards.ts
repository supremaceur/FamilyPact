import 'server-only';

import { z } from 'zod';
import {
  AuditAction,
  NotificationKind,
  ParentPermission,
  RewardEventStatus,
  RewardRuleStatus,
} from '@/generated/prisma/enums';
import { conflictError, notFoundError } from '@/domain/errors';
import { recordAudit } from '@/server/audit/audit-log';
import { requireCapability, type FamilyActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';
import { notify } from '@/server/notifications/notify';
import { getBalance } from './ledger';
import { evaluateChildRules } from './rules-engine';

/**
 * Recompenses de palier.
 *
 * Le systeme PROPOSE, le parent DISPOSE. Aucune recompense n'est accordee
 * automatiquement, et une recompense validee n'est jamais retiree si le score
 * redescend ensuite : elle a ete obtenue, c'est un fait acquis.
 *
 * Une recompense de palier ne CONSOMME aucun point : les points de FamiliPact
 * sont un score de progression, pas une monnaie (voir docs/business-rules.md).
 */

export const rewardRuleInputSchema = z.object({
  childMembershipId: z.uuid(),
  threshold: z.int().min(1, 'Le palier doit etre superieur a zero.').max(1_000_000),
  title: z.string().trim().min(1, 'Le titre est obligatoire.').max(120),
  description: z.string().trim().max(1_000).nullable().default(null),
});

export type RewardRuleInput = z.infer<typeof rewardRuleInputSchema>;

const loadChild = async (
  familyId: string,
  childMembershipId: string,
): Promise<{ readonly displayName: string }> => {
  const membership = await prisma.familyMembership.findFirst({
    where: { id: childMembershipId, familyId, role: 'CHILD', status: 'ACTIVE' },
    select: { user: { select: { displayName: true } } },
  });
  if (membership === null) throw notFoundError("Cet enfant n'existe pas dans votre famille.");
  return { displayName: membership.user.displayName };
};

export const createRewardRule = async (
  actor: FamilyActor,
  input: RewardRuleInput,
): Promise<{ readonly id: string }> => {
  requireCapability(actor, ParentPermission.RULE_MANAGE);
  const parsed = rewardRuleInputSchema.parse(input);
  const child = await loadChild(actor.familyId, parsed.childMembershipId);

  return prisma.$transaction(async (tx) => {
    const rule = await tx.rewardRule.create({
      data: {
        familyId: actor.familyId,
        childMembershipId: parsed.childMembershipId,
        threshold: parsed.threshold,
        title: parsed.title,
        description: parsed.description,
        createdById: actor.membershipId,
      },
      select: { id: true },
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.REWARD_RULE_CREATED,
      summary: `Palier « ${parsed.title} » a ${parsed.threshold} points cree pour ${child.displayName}.`,
      targetType: 'RewardRule',
      targetId: rule.id,
      metadata: {
        rewardRuleId: rule.id,
        threshold: parsed.threshold,
        childMembershipId: parsed.childMembershipId,
        childName: child.displayName,
      },
    });

    // Si le palier est deja atteint au moment ou le parent le cree, la
    // proposition est produite immediatement : le parent decrit une situation
    // qu'il constate, il attend une reponse et non un silence.
    const score = await getBalance(tx, actor.familyId, parsed.childMembershipId);
    await evaluateChildRules(tx, {
      familyId: actor.familyId,
      childMembershipId: parsed.childMembershipId,
      childName: child.displayName,
      score,
    });

    return { id: rule.id };
  });
};

export const updateRewardRule = async (
  actor: FamilyActor,
  rewardRuleId: string,
  input: RewardRuleInput,
): Promise<void> => {
  requireCapability(actor, ParentPermission.RULE_MANAGE);
  const parsed = rewardRuleInputSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.rewardRule.findFirst({
      where: { id: rewardRuleId, familyId: actor.familyId },
      select: { id: true, title: true, childMembershipId: true, events: { select: { id: true } } },
    });
    if (existing === null) throw notFoundError('Ce palier est introuvable.');
    if (existing.events.length > 0) {
      throw conflictError(
        "Ce palier a deja donne lieu a une recompense : creez-en un nouveau plutot que de modifier l'historique.",
      );
    }

    await tx.rewardRule.update({
      where: { id: rewardRuleId },
      data: {
        childMembershipId: parsed.childMembershipId,
        threshold: parsed.threshold,
        title: parsed.title,
        description: parsed.description,
      },
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.REWARD_RULE_UPDATED,
      summary: `Palier « ${existing.title} » modifie : « ${parsed.title} » a ${parsed.threshold} points.`,
      targetType: 'RewardRule',
      targetId: rewardRuleId,
      metadata: { rewardRuleId, threshold: parsed.threshold },
    });
  });
};

export const setRewardRuleStatus = async (
  actor: FamilyActor,
  rewardRuleId: string,
  status: RewardRuleStatus,
): Promise<void> => {
  requireCapability(actor, ParentPermission.RULE_MANAGE);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.rewardRule.findFirst({
      where: { id: rewardRuleId, familyId: actor.familyId },
      select: { id: true, title: true },
    });
    if (existing === null) throw notFoundError('Ce palier est introuvable.');

    await tx.rewardRule.update({ where: { id: rewardRuleId }, data: { status } });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action:
        status === RewardRuleStatus.ARCHIVED
          ? AuditAction.REWARD_RULE_ARCHIVED
          : AuditAction.REWARD_RULE_UPDATED,
      summary: `Palier « ${existing.title} » — statut : ${status}.`,
      targetType: 'RewardRule',
      targetId: rewardRuleId,
      metadata: { rewardRuleId, state: status },
    });
  });
};

export interface RewardDecisionResult {
  readonly status: RewardEventStatus;
  readonly alreadyDecided: boolean;
}

/**
 * Decision parentale sur une recompense proposee.
 *
 * La mise a jour est conditionnee au statut PENDING_PARENT_APPROVAL : deux
 * parents qui valident simultanement produisent une seule decision.
 */
const decideRewardEvent = async (
  actor: FamilyActor,
  rewardEventId: string,
  decision: 'GRANT' | 'IGNORE',
  note: string | null,
): Promise<RewardDecisionResult> => {
  requireCapability(actor, ParentPermission.REWARD_APPROVE);

  return prisma.$transaction(async (tx) => {
    const event = await tx.rewardEvent.findFirst({
      where: { id: rewardEventId, familyId: actor.familyId },
      select: {
        id: true,
        status: true,
        titleSnapshot: true,
        thresholdSnapshot: true,
        childMembershipId: true,
        child: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (event === null) throw notFoundError('Cette recompense est introuvable.');

    const nextStatus = decision === 'GRANT' ? RewardEventStatus.GRANTED : RewardEventStatus.IGNORED;

    const updated = await tx.rewardEvent.updateMany({
      where: {
        id: rewardEventId,
        familyId: actor.familyId,
        status: RewardEventStatus.PENDING_PARENT_APPROVAL,
      },
      data: {
        status: nextStatus,
        decidedAt: new Date(),
        decidedById: actor.membershipId,
        decisionNote: note,
      },
    });
    if (updated.count === 0) {
      return { status: event.status, alreadyDecided: true };
    }

    const childName = event.child.user.displayName;
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: decision === 'GRANT' ? AuditAction.REWARD_GRANTED : AuditAction.REWARD_IGNORED,
      summary:
        decision === 'GRANT'
          ? `${actor.displayName} valide la recompense « ${event.titleSnapshot} » (${event.thresholdSnapshot} points) pour ${childName}.`
          : `${actor.displayName} ignore la recompense « ${event.titleSnapshot} » pour ${childName}.`,
      targetType: 'RewardEvent',
      targetId: rewardEventId,
      metadata: {
        rewardEventId,
        threshold: event.thresholdSnapshot,
        childMembershipId: event.childMembershipId,
        childName,
        ...(note !== null ? { reason: note } : {}),
      },
    });

    if (decision === 'GRANT') {
      await notify(tx, {
        familyId: actor.familyId,
        recipientMembershipId: event.childMembershipId,
        kind: NotificationKind.REWARD_GRANTED,
        title: 'Recompense obtenue',
        body: `${actor.displayName} a valide « ${event.titleSnapshot} » (palier ${event.thresholdSnapshot} points).`,
        linkPath: '/enfant/recompenses',
        dedupeKey: `reward-granted:${rewardEventId}`,
      });
    }

    return { status: nextStatus, alreadyDecided: false };
  });
};

export const grantReward = (
  actor: FamilyActor,
  rewardEventId: string,
  note: string | null = null,
): Promise<RewardDecisionResult> => decideRewardEvent(actor, rewardEventId, 'GRANT', note);

export const ignoreReward = (
  actor: FamilyActor,
  rewardEventId: string,
  note: string | null = null,
): Promise<RewardDecisionResult> => decideRewardEvent(actor, rewardEventId, 'IGNORE', note);
