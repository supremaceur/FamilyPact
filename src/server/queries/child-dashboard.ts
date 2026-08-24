import 'server-only';

import {
  RewardEventStatus,
  RewardRuleStatus,
  SanctionInstanceStatus,
  TaskOccurrenceState,
} from '@/generated/prisma/enums';
import { nextRewardProgress, type RewardProgress } from '@/domain/rules-engine';
import { toLocalDate } from '@/domain/time';
import type { FamilyActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';

/**
 * Lectures de l'espace enfant.
 *
 * Tout est filtre a la fois par `familyId` ET par `childMembershipId` : un
 * enfant ne voit que ses propres donnees, jamais celles d'un frere ou d'une
 * soeur. Aucune requete ne prend d'identifiant venant du client.
 */

export interface ChildTaskView {
  readonly id: string;
  readonly title: string;
  readonly pointsAward: number;
  readonly pointsPenalty: number;
  readonly state: TaskOccurrenceState;
  readonly occurrenceDate: string;
  readonly dueAt: Date;
  readonly decisionNote: string | null;
}

export interface ChildSanctionView {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: SanctionInstanceStatus;
  readonly liftConditionType: string;
  readonly liftAt: Date | null;
  readonly liftScoreThreshold: number | null;
  readonly activatedAt: Date | null;
  readonly liftEligibleAt: Date | null;
}

export interface ChildDashboardData {
  readonly score: number;
  readonly displayName: string;
  readonly avatarKey: string;
  readonly colorKey: string;
  readonly nextReward: RewardProgress | null;
  readonly todayTasks: readonly ChildTaskView[];
  readonly pendingTasks: readonly ChildTaskView[];
  readonly recentlyDecided: readonly ChildTaskView[];
  readonly activeSanctions: readonly ChildSanctionView[];
  readonly grantedRewards: readonly {
    readonly id: string;
    readonly title: string;
    readonly threshold: number;
    readonly decidedAt: Date | null;
  }[];
}

const toTaskView = (occurrence: {
  id: string;
  titleSnapshot: string;
  pointsAwardSnapshot: number;
  pointsPenaltySnapshot: number;
  state: TaskOccurrenceState;
  occurrenceDate: string;
  dueAt: Date;
  decisionNote: string | null;
}): ChildTaskView => ({
  id: occurrence.id,
  title: occurrence.titleSnapshot,
  pointsAward: occurrence.pointsAwardSnapshot,
  pointsPenalty: occurrence.pointsPenaltySnapshot,
  state: occurrence.state,
  occurrenceDate: occurrence.occurrenceDate,
  dueAt: occurrence.dueAt,
  decisionNote: occurrence.decisionNote,
});

const OCCURRENCE_FIELDS = {
  id: true,
  titleSnapshot: true,
  pointsAwardSnapshot: true,
  pointsPenaltySnapshot: true,
  state: true,
  occurrenceDate: true,
  dueAt: true,
  decisionNote: true,
} as const;

export const getChildDashboard = async (actor: FamilyActor): Promise<ChildDashboardData> => {
  const today = toLocalDate(new Date(), actor.timeZone);
  const scope = { familyId: actor.familyId, childMembershipId: actor.membershipId };

  const [profile, todo, pending, decided, sanctions, rewardRules, rewardEvents] = await Promise.all(
    [
      prisma.childProfile.findFirst({
        where: { membershipId: actor.membershipId, familyId: actor.familyId },
        select: { cachedBalance: true, avatarKey: true, colorKey: true },
      }),
      prisma.taskOccurrence.findMany({
        where: {
          ...scope,
          state: { in: [TaskOccurrenceState.TODO, TaskOccurrenceState.REJECTED] },
          occurrenceDate: { lte: today },
        },
        orderBy: { dueAt: 'asc' },
        take: 50,
        select: OCCURRENCE_FIELDS,
      }),
      prisma.taskOccurrence.findMany({
        where: {
          ...scope,
          state: {
            in: [TaskOccurrenceState.CLAIMED_DONE, TaskOccurrenceState.MISSED_PENDING_REVIEW],
          },
        },
        orderBy: { dueAt: 'asc' },
        take: 50,
        select: OCCURRENCE_FIELDS,
      }),
      prisma.taskOccurrence.findMany({
        where: {
          ...scope,
          state: {
            in: [
              TaskOccurrenceState.APPROVED,
              TaskOccurrenceState.MISSED_CONFIRMED,
              TaskOccurrenceState.MISSED_IGNORED,
            ],
          },
        },
        orderBy: { decidedAt: 'desc' },
        take: 10,
        select: OCCURRENCE_FIELDS,
      }),
      prisma.sanctionInstance.findMany({
        where: {
          ...scope,
          status: {
            in: [SanctionInstanceStatus.ACTIVE, SanctionInstanceStatus.LIFT_ELIGIBLE],
          },
        },
        orderBy: { activatedAt: 'desc' },
        select: {
          id: true,
          titleSnapshot: true,
          descriptionSnapshot: true,
          status: true,
          liftConditionType: true,
          liftAt: true,
          liftScoreThreshold: true,
          activatedAt: true,
          liftEligibleAt: true,
        },
      }),
      prisma.rewardRule.findMany({
        where: { ...scope, status: RewardRuleStatus.ACTIVE },
        select: { id: true, title: true, threshold: true, status: true },
      }),
      prisma.rewardEvent.findMany({
        where: scope,
        select: {
          id: true,
          rewardRuleId: true,
          status: true,
          titleSnapshot: true,
          thresholdSnapshot: true,
          decidedAt: true,
        },
      }),
    ],
  );

  const score = profile?.cachedBalance ?? 0;
  const eventByRule = new Map(rewardEvents.map((event) => [event.rewardRuleId, event.status]));

  return {
    score,
    displayName: actor.displayName,
    avatarKey: profile?.avatarKey ?? 'fox',
    colorKey: profile?.colorKey ?? 'sage',
    nextReward: nextRewardProgress(
      score,
      rewardRules.map((rule) => ({
        id: rule.id,
        title: rule.title,
        threshold: rule.threshold,
        status: rule.status,
        eventStatus: eventByRule.get(rule.id) ?? null,
      })),
    ),
    todayTasks: todo.map(toTaskView),
    pendingTasks: pending.map(toTaskView),
    recentlyDecided: decided.map(toTaskView),
    activeSanctions: sanctions.map((sanction) => ({
      id: sanction.id,
      title: sanction.titleSnapshot,
      description: sanction.descriptionSnapshot,
      status: sanction.status,
      liftConditionType: sanction.liftConditionType,
      liftAt: sanction.liftAt,
      liftScoreThreshold: sanction.liftScoreThreshold,
      activatedAt: sanction.activatedAt,
      liftEligibleAt: sanction.liftEligibleAt,
    })),
    grantedRewards: rewardEvents
      .filter((event) => event.status === RewardEventStatus.GRANTED)
      .map((event) => ({
        id: event.id,
        title: event.titleSnapshot,
        threshold: event.thresholdSnapshot,
        decidedAt: event.decidedAt,
      })),
  };
};
