import 'server-only';

import {
  FamilyRole,
  RewardEventStatus,
  RewardRuleStatus,
  SanctionInstanceStatus,
  TaskOccurrenceState,
} from '@/generated/prisma/enums';
import { nextRewardProgress, rewardBelowThreshold } from '@/domain/rules-engine';
import type { ActionRequiredCountsView, ChildSummaryView } from '@/lib/read-models';
import type { FamilyActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';

/**
 * Lectures du tableau de bord parent.
 *
 * Toutes les requetes sont filtrees par `actor.familyId` : l'isolation entre
 * familles ne repose jamais sur un identifiant fourni par le client.
 *
 * Les compteurs sont obtenus en quelques requetes groupees plutot qu'en
 * interrogeant la base enfant par enfant, ce qui evite les requetes N+1.
 */

/** Les formes exposees a l'interface vivent dans `src/lib/read-models`. */
export type ChildSummary = ChildSummaryView;
export type ActionRequiredCounts = ActionRequiredCountsView;

export interface ParentDashboardData {
  readonly children: readonly ChildSummary[];
  readonly actionsRequired: ActionRequiredCounts;
}

export const getParentDashboard = async (actor: FamilyActor): Promise<ParentDashboardData> => {
  const familyId = actor.familyId;

  const [
    children,
    occurrenceCounts,
    sanctionCounts,
    rewardRules,
    rewardEvents,
    pendingRewards,
    revocableRewards,
  ] = await Promise.all([
    prisma.familyMembership.findMany({
      where: { familyId, role: FamilyRole.CHILD, status: 'ACTIVE' },
      orderBy: { joinedAt: 'asc' },
      select: {
        id: true,
        user: { select: { displayName: true } },
        childProfile: { select: { avatarKey: true, colorKey: true, cachedBalance: true } },
      },
    }),
    prisma.taskOccurrence.groupBy({
      by: ['childMembershipId', 'state'],
      where: {
        familyId,
        state: {
          in: [TaskOccurrenceState.CLAIMED_DONE, TaskOccurrenceState.MISSED_PENDING_REVIEW],
        },
      },
      _count: { _all: true },
    }),
    prisma.sanctionInstance.groupBy({
      by: ['childMembershipId', 'status'],
      where: {
        familyId,
        status: {
          in: [
            SanctionInstanceStatus.PROPOSED,
            SanctionInstanceStatus.ACTIVE,
            SanctionInstanceStatus.LIFT_ELIGIBLE,
          ],
        },
      },
      _count: { _all: true },
    }),
    prisma.rewardRule.findMany({
      where: { familyId, status: RewardRuleStatus.ACTIVE },
      select: { id: true, title: true, threshold: true, status: true, childMembershipId: true },
    }),
    prisma.rewardEvent.findMany({
      where: { familyId },
      select: { rewardRuleId: true, status: true },
    }),
    prisma.rewardEvent.count({
      where: { familyId, status: RewardEventStatus.PENDING_PARENT_APPROVAL },
    }),
    // Recompenses qui durent, encore detenues, non arbitrees. Le seuil est
    // compare au score en memoire : la suggestion n'est jamais persistee.
    prisma.rewardEvent.findMany({
      where: {
        familyId,
        status: RewardEventStatus.GRANTED,
        keptAt: null,
        rewardRule: { revocable: true },
      },
      select: {
        thresholdSnapshot: true,
        child: { select: { childProfile: { select: { cachedBalance: true } } } },
      },
    }),
  ]);

  const eventByRule = new Map(rewardEvents.map((event) => [event.rewardRuleId, event.status]));

  const countFor = <T extends { childMembershipId: string; _count: { _all: number } }>(
    rows: readonly T[],
    childId: string,
    predicate: (row: T) => boolean,
  ): number =>
    rows
      .filter((row) => row.childMembershipId === childId && predicate(row))
      .reduce((total, row) => total + row._count._all, 0);

  const summaries: ChildSummary[] = children.map((child) => {
    const score = child.childProfile?.cachedBalance ?? 0;
    const candidateRules = rewardRules
      .filter((rule) => rule.childMembershipId === child.id)
      .map((rule) => ({
        id: rule.id,
        title: rule.title,
        threshold: rule.threshold,
        status: rule.status,
        eventStatus: eventByRule.get(rule.id) ?? null,
      }));

    return {
      membershipId: child.id,
      displayName: child.user.displayName,
      avatarKey: child.childProfile?.avatarKey ?? 'fox',
      colorKey: child.childProfile?.colorKey ?? 'sage',
      score,
      pendingApprovals: countFor(
        occurrenceCounts,
        child.id,
        (row) => row.state === TaskOccurrenceState.CLAIMED_DONE,
      ),
      pendingMissed: countFor(
        occurrenceCounts,
        child.id,
        (row) => row.state === TaskOccurrenceState.MISSED_PENDING_REVIEW,
      ),
      activeSanctions: countFor(
        sanctionCounts,
        child.id,
        (row) =>
          row.status === SanctionInstanceStatus.ACTIVE ||
          row.status === SanctionInstanceStatus.LIFT_ELIGIBLE,
      ),
      nextReward: nextRewardProgress(score, candidateRules),
    };
  });

  const taskApprovals = occurrenceCounts
    .filter((row) => row.state === TaskOccurrenceState.CLAIMED_DONE)
    .reduce((total, row) => total + row._count._all, 0);
  const missedReviews = occurrenceCounts
    .filter((row) => row.state === TaskOccurrenceState.MISSED_PENDING_REVIEW)
    .reduce((total, row) => total + row._count._all, 0);
  const sanctionActivations = sanctionCounts
    .filter((row) => row.status === SanctionInstanceStatus.PROPOSED)
    .reduce((total, row) => total + row._count._all, 0);
  const sanctionLifts = sanctionCounts
    .filter((row) => row.status === SanctionInstanceStatus.LIFT_ELIGIBLE)
    .reduce((total, row) => total + row._count._all, 0);
  const rewardRevocations = revocableRewards.filter((reward) =>
    rewardBelowThreshold(reward.child.childProfile?.cachedBalance ?? 0, reward.thresholdSnapshot),
  ).length;

  return {
    children: summaries,
    actionsRequired: {
      taskApprovals,
      missedReviews,
      rewardApprovals: pendingRewards,
      rewardRevocations,
      sanctionActivations,
      sanctionLifts,
      total:
        taskApprovals +
        missedReviews +
        pendingRewards +
        rewardRevocations +
        sanctionActivations +
        sanctionLifts,
    },
  };
};

/** Detail des decisions en attente, groupees par nature. */
export const getPendingDecisions = async (actor: FamilyActor) => {
  const familyId = actor.familyId;

  const [claimed, missed, rewards, sanctions] = await Promise.all([
    prisma.taskOccurrence.findMany({
      where: { familyId, state: TaskOccurrenceState.CLAIMED_DONE },
      orderBy: { claimedAt: 'asc' },
      take: 100,
      select: {
        id: true,
        titleSnapshot: true,
        pointsAwardSnapshot: true,
        pointsPenaltySnapshot: true,
        occurrenceDate: true,
        dueAt: true,
        claimedAt: true,
        childMembershipId: true,
        child: {
          select: {
            user: { select: { displayName: true } },
            childProfile: { select: { cachedBalance: true, avatarKey: true, colorKey: true } },
          },
        },
      },
    }),
    prisma.taskOccurrence.findMany({
      where: { familyId, state: TaskOccurrenceState.MISSED_PENDING_REVIEW },
      orderBy: { dueAt: 'asc' },
      take: 100,
      select: {
        id: true,
        titleSnapshot: true,
        pointsAwardSnapshot: true,
        pointsPenaltySnapshot: true,
        occurrenceDate: true,
        dueAt: true,
        missedDetectedAt: true,
        childMembershipId: true,
        child: {
          select: {
            user: { select: { displayName: true } },
            childProfile: { select: { cachedBalance: true, avatarKey: true, colorKey: true } },
          },
        },
      },
    }),
    prisma.rewardEvent.findMany({
      where: { familyId, status: RewardEventStatus.PENDING_PARENT_APPROVAL },
      orderBy: { proposedAt: 'asc' },
      take: 100,
      select: {
        id: true,
        titleSnapshot: true,
        thresholdSnapshot: true,
        scoreAtProposal: true,
        proposedAt: true,
        childMembershipId: true,
        child: {
          select: {
            user: { select: { displayName: true } },
            childProfile: { select: { cachedBalance: true, avatarKey: true, colorKey: true } },
          },
        },
      },
    }),
    prisma.sanctionInstance.findMany({
      where: {
        familyId,
        status: { in: [SanctionInstanceStatus.PROPOSED, SanctionInstanceStatus.LIFT_ELIGIBLE] },
      },
      orderBy: { proposedAt: 'asc' },
      take: 100,
      select: {
        id: true,
        status: true,
        titleSnapshot: true,
        descriptionSnapshot: true,
        thresholdSnapshot: true,
        comparatorSnapshot: true,
        scoreAtProposal: true,
        proposedAt: true,
        liftConditionType: true,
        liftAt: true,
        liftScoreThreshold: true,
        liftEligibleAt: true,
        childMembershipId: true,
        sanctionRule: {
          select: { liftConditionType: true, liftScoreThreshold: true, liftDurationDays: true },
        },
        child: {
          select: {
            user: { select: { displayName: true } },
            childProfile: { select: { cachedBalance: true, avatarKey: true, colorKey: true } },
          },
        },
      },
    }),
  ]);

  return { claimed, missed, rewards, sanctions };
};
