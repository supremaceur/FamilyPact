import 'server-only';

import { z } from 'zod';
import {
  AuditAction,
  NotificationKind,
  ParentPermission,
  RewardEventStatus,
  RewardRuleStatus,
} from '@/generated/prisma/enums';
import { conflictError, notFoundError, validationError } from '@/domain/errors';
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
 * automatiquement, et aucune n'est retiree automatiquement non plus.
 *
 * Deux natures de recompense, declarees par la famille a la creation du palier
 * (`RewardRule.revocable`) :
 *
 *   - PONCTUELLE (defaut) — un restaurant, une sortie. Une fois vecue, elle ne
 *     se reprend pas. L'application ne propose meme pas de la retirer.
 *   - QUI DURE — du temps d'ecran, une permission hebdomadaire. Si le score
 *     repasse sous le palier, l'application le SIGNALE ; un parent retire, ou
 *     laisse. Les deux reponses sont normales.
 *
 * Une recompense de palier ne CONSOMME aucun point, et son retrait n'en rend
 * aucun : les points de FamiliPact sont un score de progression, pas une
 * monnaie (voir docs/business-rules.md).
 */

export const rewardRuleInputSchema = z.object({
  childMembershipId: z.uuid(),
  threshold: z.int().min(1, 'Le palier doit etre superieur a zero.').max(1_000_000),
  title: z.string().trim().min(1, 'Le titre est obligatoire.').max(120),
  description: z.string().trim().max(1_000).nullable().default(null),
  /** Recompense qui dure, donc retirable. Voir l'en-tete du module. */
  revocable: z.boolean().default(false),
});

/**
 * Type d'ENTREE, pas de sortie : `z.input` laisse optionnels les champs qui ont
 * une valeur par defaut. Un appelant qui ne connait pas `revocable` obtient une
 * recompense ponctuelle — le comportement le plus sur, et celui d'avant.
 */
export type RewardRuleInput = z.input<typeof rewardRuleInputSchema>;

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
        revocable: parsed.revocable,
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
        revocable: parsed.revocable,
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

// ---------------------------------------------------------------------------
// Retrait d'une recompense qui durait
// ---------------------------------------------------------------------------

export interface RewardRevocationResult {
  readonly status: RewardEventStatus;
  /** Un autre parent avait deja tranche : la reponse le dit plutot qu'echouer. */
  readonly alreadyDecided: boolean;
}

/**
 * Retire une recompense accordee.
 *
 * Trois garde-fous, dans cet ordre :
 *
 *   1. seule une recompense ACCORDEE peut etre retiree — on ne retire pas une
 *      proposition en attente, on l'ignore ;
 *   2. seule une regle declaree `revocable` le permet — c'est la famille qui a
 *      dit, en creant le palier, que cette recompense durait ;
 *   3. le motif est obligatoire — l'enfant doit savoir pourquoi, et le retrait
 *      apparait dans son historique avec ce motif.
 *
 * AUCUN POINT N'EST RENDU NI RETIRE. La recompense n'avait rien coute : elle
 * n'a rien a rembourser. Confondre les deux ferait des points une monnaie.
 *
 * Le score courant n'est volontairement PAS verifie ici. Un parent peut retirer
 * une recompense pour une raison qui n'a rien a voir avec le score, et
 * l'application n'a pas a lui demander de justifier sa decision par un chiffre.
 * Le score ne sert qu'a SIGNALER (voir `suggestRewardRevocations`).
 */
export const revokeReward = async (
  actor: FamilyActor,
  rewardEventId: string,
  reason: string,
): Promise<RewardRevocationResult> => {
  requireCapability(actor, ParentPermission.REWARD_APPROVE);

  const motif = reason.trim();
  if (motif.length === 0) {
    throw validationError('Indiquez pourquoi la recompense est retiree.');
  }
  if (motif.length > 1_000) {
    throw validationError('Le motif est trop long.');
  }

  return prisma.$transaction(async (tx) => {
    const event = await tx.rewardEvent.findFirst({
      where: { id: rewardEventId, familyId: actor.familyId },
      select: {
        id: true,
        status: true,
        titleSnapshot: true,
        thresholdSnapshot: true,
        childMembershipId: true,
        rewardRule: { select: { revocable: true } },
        child: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (event === null) throw notFoundError('Cette recompense est introuvable.');

    if (!event.rewardRule.revocable) {
      throw conflictError(
        'Ce palier a ete cree comme une recompense ponctuelle : une fois accordee, elle ne se retire pas. Seules les recompenses qui durent sont retirables.',
      );
    }

    const updated = await tx.rewardEvent.updateMany({
      where: { id: rewardEventId, familyId: actor.familyId, status: RewardEventStatus.GRANTED },
      data: {
        status: RewardEventStatus.REVOKED,
        revokedAt: new Date(),
        revokedById: actor.membershipId,
        revocationReason: motif,
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
      action: AuditAction.REWARD_REVOKED,
      summary: `${actor.displayName} retire la recompense « ${event.titleSnapshot} » a ${childName}.`,
      targetType: 'RewardEvent',
      targetId: rewardEventId,
      metadata: {
        rewardEventId,
        threshold: event.thresholdSnapshot,
        childMembershipId: event.childMembershipId,
        childName,
        reason: motif,
      },
    });

    await notify(tx, {
      familyId: actor.familyId,
      recipientMembershipId: event.childMembershipId,
      kind: NotificationKind.REWARD_REVOKED,
      title: 'Recompense retiree',
      body: `${actor.displayName} a retire « ${event.titleSnapshot} ». Motif : ${motif}`,
      linkPath: '/enfant/recompenses',
      dedupeKey: `reward-revoked:${rewardEventId}`,
    });

    return { status: RewardEventStatus.REVOKED, alreadyDecided: false };
  });
};

/**
 * Laisse la recompense malgre un score redescendu sous le palier.
 *
 * Ne change rien a la recompense : marque seulement que la question a ete
 * tranchee, pour que l'application cesse de la poser. Une application qui
 * redemande tous les jours finit par obtenir un oui de lassitude — et ce oui-la
 * ne serait pas une decision.
 *
 * Le retrait manuel reste possible ensuite, a tout moment.
 */
export const keepReward = async (
  actor: FamilyActor,
  rewardEventId: string,
  note: string | null = null,
): Promise<RewardRevocationResult> => {
  requireCapability(actor, ParentPermission.REWARD_APPROVE);

  return prisma.$transaction(async (tx) => {
    const event = await tx.rewardEvent.findFirst({
      where: { id: rewardEventId, familyId: actor.familyId },
      select: {
        id: true,
        status: true,
        keptAt: true,
        titleSnapshot: true,
        childMembershipId: true,
        child: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (event === null) throw notFoundError('Cette recompense est introuvable.');

    const updated = await tx.rewardEvent.updateMany({
      where: {
        id: rewardEventId,
        familyId: actor.familyId,
        status: RewardEventStatus.GRANTED,
        keptAt: null,
      },
      data: { keptAt: new Date() },
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
      action: AuditAction.REWARD_KEPT,
      summary: `${actor.displayName} laisse la recompense « ${event.titleSnapshot} » a ${childName} malgre un score redescendu.`,
      targetType: 'RewardEvent',
      targetId: rewardEventId,
      metadata: {
        rewardEventId,
        childMembershipId: event.childMembershipId,
        childName,
        ...(note !== null && note.trim().length > 0 ? { reason: note.trim() } : {}),
      },
    });

    // Aucune notification : l'enfant garde ce qu'il avait. Le prevenir qu'on a
    // envisage de le lui retirer ne lui apprendrait rien d'utile.
    return { status: RewardEventStatus.GRANTED, alreadyDecided: false };
  });
};
