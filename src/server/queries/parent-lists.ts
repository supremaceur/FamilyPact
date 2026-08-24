import 'server-only';

import {
  FamilyRole,
  RewardEventStatus,
  RewardRuleStatus,
  SanctionRuleStatus,
} from '@/generated/prisma/enums';
import { notFoundError } from '@/domain/errors';
import { rewardBelowThreshold } from '@/domain/rules-engine';
import type { FamilyActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';

/**
 * Listes de gestion de l'espace parent.
 *
 * Chaque requete est filtree par `actor.familyId`. Aucun identifiant de famille
 * ne vient jamais du client : un identifiant de ressource manipule dans l'URL
 * ne peut donc mener qu'a un 404, jamais aux donnees d'une autre famille.
 */

export const listTaskDefinitions = async (actor: FamilyActor) =>
  prisma.taskDefinition.findMany({
    where: { familyId: actor.familyId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      description: true,
      pointsAward: true,
      pointsPenalty: true,
      recurrence: true,
      weekdays: true,
      startDate: true,
      endDate: true,
      dueTime: true,
      dueAt: true,
      status: true,
      version: true,
      childMembershipId: true,
      child: {
        select: {
          user: { select: { displayName: true } },
          childProfile: { select: { avatarKey: true, colorKey: true } },
        },
      },
      createdBy: { select: { user: { select: { displayName: true } } } },
      _count: { select: { occurrences: true } },
    },
  });

export const getTaskDefinition = async (actor: FamilyActor, taskId: string) => {
  const definition = await prisma.taskDefinition.findFirst({
    where: { id: taskId, familyId: actor.familyId },
    select: {
      id: true,
      title: true,
      description: true,
      pointsAward: true,
      pointsPenalty: true,
      recurrence: true,
      weekdays: true,
      startDate: true,
      endDate: true,
      dueTime: true,
      dueAt: true,
      status: true,
      version: true,
      childMembershipId: true,
      occurrences: {
        orderBy: { occurrenceDate: 'desc' },
        take: 40,
        select: {
          id: true,
          occurrenceDate: true,
          dueAt: true,
          state: true,
          titleSnapshot: true,
          pointsAwardSnapshot: true,
          pointsPenaltySnapshot: true,
          definitionVersion: true,
          decidedAt: true,
          decidedBy: { select: { user: { select: { displayName: true } } } },
        },
      },
    },
  });
  if (definition === null) throw notFoundError('Cette tache est introuvable.');
  return definition;
};

export const listRewardRules = async (actor: FamilyActor) =>
  prisma.rewardRule.findMany({
    where: { familyId: actor.familyId, status: { not: RewardRuleStatus.ARCHIVED } },
    orderBy: [{ childMembershipId: 'asc' }, { threshold: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      threshold: true,
      status: true,
      childMembershipId: true,
      child: {
        select: {
          user: { select: { displayName: true } },
          childProfile: { select: { cachedBalance: true, avatarKey: true, colorKey: true } },
        },
      },
      events: {
        select: { id: true, status: true, decidedAt: true },
      },
    },
  });

export const listSanctionRules = async (actor: FamilyActor) =>
  prisma.sanctionRule.findMany({
    where: { familyId: actor.familyId, status: { not: SanctionRuleStatus.ARCHIVED } },
    orderBy: [{ childMembershipId: 'asc' }, { threshold: 'desc' }],
    select: {
      id: true,
      title: true,
      description: true,
      threshold: true,
      comparator: true,
      status: true,
      armed: true,
      liftConditionType: true,
      liftScoreThreshold: true,
      liftDurationDays: true,
      childMembershipId: true,
      child: {
        select: {
          user: { select: { displayName: true } },
          childProfile: { select: { cachedBalance: true, avatarKey: true, colorKey: true } },
        },
      },
      instances: {
        orderBy: { proposedAt: 'desc' },
        take: 5,
        select: { id: true, status: true, proposedAt: true, activatedAt: true, liftedAt: true },
      },
    },
  });

export const listSanctionInstances = async (actor: FamilyActor) =>
  prisma.sanctionInstance.findMany({
    where: { familyId: actor.familyId },
    orderBy: { proposedAt: 'desc' },
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
      activatedAt: true,
      liftConditionType: true,
      liftAt: true,
      liftScoreThreshold: true,
      liftEligibleAt: true,
      liftedAt: true,
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
      activatedBy: { select: { user: { select: { displayName: true } } } },
      liftedBy: { select: { user: { select: { displayName: true } } } },
    },
  });

export const listRewardEvents = async (actor: FamilyActor) =>
  prisma.rewardEvent.findMany({
    where: { familyId: actor.familyId },
    orderBy: { proposedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      status: true,
      titleSnapshot: true,
      thresholdSnapshot: true,
      scoreAtProposal: true,
      proposedAt: true,
      decidedAt: true,
      keptAt: true,
      revokedAt: true,
      revocationReason: true,
      childMembershipId: true,
      // `revocable` est porte par la REGLE, pas par l'evenement : la famille
      // declare une bonne fois que ce palier donne une recompense qui dure.
      rewardRule: { select: { revocable: true } },
      child: {
        select: {
          user: { select: { displayName: true } },
          childProfile: { select: { cachedBalance: true, avatarKey: true, colorKey: true } },
        },
      },
      decidedBy: { select: { user: { select: { displayName: true } } } },
      revokedBy: { select: { user: { select: { displayName: true } } } },
    },
  });

/**
 * Recompenses qui durent, encore detenues, dont le score est repasse sous le
 * palier — donc a SIGNALER au parent.
 *
 * Rien n'est persiste : la liste est recalculee a chaque affichage a partir du
 * score courant. Elle disparait donc d'elle-meme si le score remonte, sans
 * traitement de rattrapage ni risque de derive entre une proposition figee et
 * la realite.
 */
export const listRewardRevocationSuggestions = async (actor: FamilyActor) => {
  const events = await prisma.rewardEvent.findMany({
    where: {
      familyId: actor.familyId,
      status: RewardEventStatus.GRANTED,
      keptAt: null,
      rewardRule: { revocable: true },
    },
    orderBy: { decidedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      titleSnapshot: true,
      thresholdSnapshot: true,
      decidedAt: true,
      childMembershipId: true,
      child: {
        select: {
          user: { select: { displayName: true } },
          childProfile: { select: { cachedBalance: true, avatarKey: true, colorKey: true } },
        },
      },
    },
  });

  return events
    .map((event) => ({ event, score: event.child.childProfile?.cachedBalance ?? 0 }))
    .filter(({ event, score }) => rewardBelowThreshold(score, event.thresholdSnapshot))
    .map(({ event, score }) => ({
      id: event.id,
      title: event.titleSnapshot,
      threshold: event.thresholdSnapshot,
      grantedAt: event.decidedAt,
      score,
      childMembershipId: event.childMembershipId,
      childName: event.child.user.displayName,
      avatarKey: event.child.childProfile?.avatarKey ?? 'fox',
      colorKey: event.child.childProfile?.colorKey ?? 'sage',
    }));
};

/** Detail complet d'un enfant, pour la fiche de l'espace parent. */
export const getChildDetail = async (actor: FamilyActor, childMembershipId: string) => {
  const child = await prisma.familyMembership.findFirst({
    where: { id: childMembershipId, familyId: actor.familyId, role: FamilyRole.CHILD },
    select: {
      id: true,
      status: true,
      joinedAt: true,
      user: { select: { id: true, displayName: true, loginId: true, lastLoginAt: true } },
      childProfile: {
        select: {
          avatarKey: true,
          colorKey: true,
          cachedBalance: true,
          transactionCount: true,
          balanceUpdatedAt: true,
        },
      },
    },
  });
  if (child === null) throw notFoundError("Cet enfant n'existe pas dans votre famille.");
  return child;
};
