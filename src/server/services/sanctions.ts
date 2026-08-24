import 'server-only';

import { z } from 'zod';
import {
  AuditAction,
  LiftConditionType,
  NotificationKind,
  ParentPermission,
  SanctionInstanceStatus,
  SanctionRuleStatus,
  ScoreComparator,
} from '@/generated/prisma/enums';
import { notFoundError, validationError } from '@/domain/errors';
import { liftConfigurationIssues, resolveLiftCondition } from '@/domain/rules-engine';
import { recordAudit } from '@/server/audit/audit-log';
import { requireCapability, type FamilyActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';
import { notify } from '@/server/notifications/notify';
import { getBalance } from './ledger';
import { evaluateChildRules, initialArmedState } from './rules-engine';

/**
 * Sanctions.
 *
 * FamiliPact n'applique JAMAIS une sanction dans le monde reel : il n'agit sur
 * aucun appareil, aucune application, aucun acces. Une sanction est une
 * information de gestion — sa mise en oeuvre reste la responsabilite du parent.
 *
 * Chaine complete : seuil franchi → PROPOSITION → decision parentale →
 * ACTIVE → condition de levee atteinte → LIFT_ELIGIBLE → decision parentale →
 * LEVEE. Aucune etape n'est franchie automatiquement au-dela de la detection.
 */

export const sanctionRuleInputSchema = z
  .object({
    childMembershipId: z.uuid(),
    threshold: z.int().min(-1_000_000).max(1_000_000),
    comparator: z.enum(ScoreComparator).default(ScoreComparator.LT),
    title: z.string().trim().min(1, 'Le titre est obligatoire.').max(120),
    description: z.string().trim().max(1_000).nullable().default(null),
    liftConditionType: z.enum(LiftConditionType).default(LiftConditionType.MANUAL),
    liftScoreThreshold: z.int().min(-1_000_000).max(1_000_000).nullable().default(null),
    liftDurationDays: z.int().min(1).max(3_650).nullable().default(null),
  })
  .superRefine((value, context) => {
    const issues = liftConfigurationIssues({
      type: value.liftConditionType,
      scoreThreshold: value.liftScoreThreshold,
      durationDays: value.liftDurationDays,
      explicitLiftAt: null,
    });
    for (const issue of issues) {
      context.addIssue({ code: 'custom', message: issue, path: ['liftConditionType'] });
    }
  });

export type SanctionRuleInput = z.infer<typeof sanctionRuleInputSchema>;

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

export const createSanctionRule = async (
  actor: FamilyActor,
  input: SanctionRuleInput,
): Promise<{ readonly id: string }> => {
  requireCapability(actor, ParentPermission.RULE_MANAGE);
  const parsed = sanctionRuleInputSchema.parse(input);
  const child = await loadChild(actor.familyId, parsed.childMembershipId);

  return prisma.$transaction(async (tx) => {
    const score = await getBalance(tx, actor.familyId, parsed.childMembershipId);

    const rule = await tx.sanctionRule.create({
      data: {
        familyId: actor.familyId,
        childMembershipId: parsed.childMembershipId,
        threshold: parsed.threshold,
        comparator: parsed.comparator,
        title: parsed.title,
        description: parsed.description,
        liftConditionType: parsed.liftConditionType,
        liftScoreThreshold: parsed.liftScoreThreshold,
        liftDurationDays: parsed.liftDurationDays,
        // La regle nait « armee » si le score est au-dessus du seuil. Sinon elle
        // nait desarmee et l'evaluation ci-dessous produit une proposition
        // immediate : le parent decrit une situation deja constatee.
        armed: initialArmedState(score, parsed.threshold, parsed.comparator),
        createdById: actor.membershipId,
      },
      select: { id: true },
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.SANCTION_RULE_CREATED,
      summary: `Regle de sanction « ${parsed.title} » creee pour ${child.displayName} (score ${parsed.comparator === ScoreComparator.LTE ? '<=' : '<'} ${parsed.threshold}).`,
      targetType: 'SanctionRule',
      targetId: rule.id,
      metadata: {
        sanctionRuleId: rule.id,
        threshold: parsed.threshold,
        childMembershipId: parsed.childMembershipId,
        childName: child.displayName,
        liftConditionType: parsed.liftConditionType,
      },
    });

    await evaluateChildRules(tx, {
      familyId: actor.familyId,
      childMembershipId: parsed.childMembershipId,
      childName: child.displayName,
      score,
    });

    return { id: rule.id };
  });
};

export const updateSanctionRule = async (
  actor: FamilyActor,
  sanctionRuleId: string,
  input: SanctionRuleInput,
): Promise<void> => {
  requireCapability(actor, ParentPermission.RULE_MANAGE);
  const parsed = sanctionRuleInputSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.sanctionRule.findFirst({
      where: { id: sanctionRuleId, familyId: actor.familyId },
      select: { id: true, title: true, threshold: true, comparator: true, childMembershipId: true },
    });
    if (existing === null) throw notFoundError('Cette regle est introuvable.');

    const thresholdChanged =
      existing.threshold !== parsed.threshold || existing.comparator !== parsed.comparator;
    const score = await getBalance(tx, actor.familyId, parsed.childMembershipId);

    await tx.sanctionRule.update({
      where: { id: sanctionRuleId },
      data: {
        childMembershipId: parsed.childMembershipId,
        threshold: parsed.threshold,
        comparator: parsed.comparator,
        title: parsed.title,
        description: parsed.description,
        liftConditionType: parsed.liftConditionType,
        liftScoreThreshold: parsed.liftScoreThreshold,
        liftDurationDays: parsed.liftDurationDays,
        // Changer le seuil redefinit le franchissement : l'armement est
        // recalcule pour eviter de proposer une sanction sur un seuil obsolete.
        ...(thresholdChanged
          ? { armed: initialArmedState(score, parsed.threshold, parsed.comparator) }
          : {}),
      },
    });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.SANCTION_RULE_UPDATED,
      summary: `Regle de sanction « ${existing.title} » modifiee : « ${parsed.title} » (seuil ${parsed.threshold}).`,
      targetType: 'SanctionRule',
      targetId: sanctionRuleId,
      metadata: { sanctionRuleId, threshold: parsed.threshold },
    });

    const child = await loadChild(actor.familyId, parsed.childMembershipId);
    await evaluateChildRules(tx, {
      familyId: actor.familyId,
      childMembershipId: parsed.childMembershipId,
      childName: child.displayName,
      score,
    });
  });
};

export const setSanctionRuleStatus = async (
  actor: FamilyActor,
  sanctionRuleId: string,
  status: SanctionRuleStatus,
): Promise<void> => {
  requireCapability(actor, ParentPermission.RULE_MANAGE);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.sanctionRule.findFirst({
      where: { id: sanctionRuleId, familyId: actor.familyId },
      select: { id: true, title: true },
    });
    if (existing === null) throw notFoundError('Cette regle est introuvable.');

    await tx.sanctionRule.update({ where: { id: sanctionRuleId }, data: { status } });

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action:
        status === SanctionRuleStatus.ARCHIVED
          ? AuditAction.SANCTION_RULE_ARCHIVED
          : AuditAction.SANCTION_RULE_UPDATED,
      summary: `Regle de sanction « ${existing.title} » — statut : ${status}.`,
      targetType: 'SanctionRule',
      targetId: sanctionRuleId,
      metadata: { sanctionRuleId, state: status },
    });
  });
};

// ---------------------------------------------------------------------------
// Decisions parentales sur une sanction proposee
// ---------------------------------------------------------------------------

export const activationInputSchema = z
  .object({
    liftConditionType: z.enum(LiftConditionType),
    liftScoreThreshold: z.int().min(-1_000_000).max(1_000_000).nullable().default(null),
    liftDurationDays: z.int().min(1).max(3_650).nullable().default(null),
    /** Date de fin explicite, prioritaire sur la duree. */
    liftAt: z.iso.datetime().nullable().default(null),
  })
  .superRefine((value, context) => {
    const issues = liftConfigurationIssues({
      type: value.liftConditionType,
      scoreThreshold: value.liftScoreThreshold,
      durationDays: value.liftDurationDays,
      explicitLiftAt: value.liftAt !== null ? new Date(value.liftAt) : null,
    });
    for (const issue of issues) {
      context.addIssue({ code: 'custom', message: issue, path: ['liftConditionType'] });
    }
  });

export type ActivationInput = z.infer<typeof activationInputSchema>;

export interface SanctionDecisionResult {
  readonly status: SanctionInstanceStatus;
  readonly alreadyDecided: boolean;
}

/** Le parent active une sanction proposee, en figeant sa condition de levee. */
export const activateSanction = async (
  actor: FamilyActor,
  sanctionInstanceId: string,
  input: ActivationInput,
): Promise<SanctionDecisionResult> => {
  requireCapability(actor, ParentPermission.SANCTION_ACTIVATE);
  const parsed = activationInputSchema.parse(input);

  return prisma.$transaction(async (tx) => {
    const instance = await tx.sanctionInstance.findFirst({
      where: { id: sanctionInstanceId, familyId: actor.familyId },
      select: {
        id: true,
        status: true,
        titleSnapshot: true,
        childMembershipId: true,
        child: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (instance === null) throw notFoundError('Cette sanction est introuvable.');

    const now = new Date();
    const resolved = resolveLiftCondition(
      {
        type: parsed.liftConditionType,
        scoreThreshold: parsed.liftScoreThreshold,
        durationDays: parsed.liftDurationDays,
        explicitLiftAt: parsed.liftAt !== null ? new Date(parsed.liftAt) : null,
      },
      now,
    );

    if (resolved.liftAt !== null && resolved.liftAt.getTime() <= now.getTime()) {
      throw validationError('La date de levee doit se situer dans le futur.');
    }

    const updated = await tx.sanctionInstance.updateMany({
      where: {
        id: sanctionInstanceId,
        familyId: actor.familyId,
        status: SanctionInstanceStatus.PROPOSED,
      },
      data: {
        status: SanctionInstanceStatus.ACTIVE,
        activatedAt: now,
        activatedById: actor.membershipId,
        liftConditionType: resolved.liftConditionType,
        liftAt: resolved.liftAt,
        liftScoreThreshold: resolved.liftScoreThreshold,
      },
    });
    if (updated.count === 0) {
      return { status: instance.status, alreadyDecided: true };
    }

    const childName = instance.child.user.displayName;
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.SANCTION_ACTIVATED,
      summary: `${actor.displayName} active la sanction « ${instance.titleSnapshot} » pour ${childName}.`,
      targetType: 'SanctionInstance',
      targetId: sanctionInstanceId,
      metadata: {
        sanctionInstanceId,
        childMembershipId: instance.childMembershipId,
        childName,
        liftConditionType: resolved.liftConditionType,
      },
    });

    await notify(tx, {
      familyId: actor.familyId,
      recipientMembershipId: instance.childMembershipId,
      kind: NotificationKind.SANCTION_ACTIVATED,
      title: 'Une sanction est active',
      body: `${actor.displayName} a active « ${instance.titleSnapshot} ».`,
      linkPath: '/enfant/sanctions',
      dedupeKey: `sanction-activated:${sanctionInstanceId}`,
    });

    // La condition de levee peut deja etre remplie (palier de score atteint) :
    // on reevalue immediatement pour ne pas attendre le prochain job.
    const score = await getBalance(tx, actor.familyId, instance.childMembershipId);
    await evaluateChildRules(tx, {
      familyId: actor.familyId,
      childMembershipId: instance.childMembershipId,
      childName,
      score,
      now,
    });

    return { status: SanctionInstanceStatus.ACTIVE, alreadyDecided: false };
  });
};

/** Le parent ignore une sanction proposee : elle ne prend jamais effet. */
export const ignoreSanction = async (
  actor: FamilyActor,
  sanctionInstanceId: string,
): Promise<SanctionDecisionResult> => {
  requireCapability(actor, ParentPermission.SANCTION_ACTIVATE);

  return prisma.$transaction(async (tx) => {
    const instance = await tx.sanctionInstance.findFirst({
      where: { id: sanctionInstanceId, familyId: actor.familyId },
      select: {
        id: true,
        status: true,
        titleSnapshot: true,
        childMembershipId: true,
        child: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (instance === null) throw notFoundError('Cette sanction est introuvable.');

    const updated = await tx.sanctionInstance.updateMany({
      where: {
        id: sanctionInstanceId,
        familyId: actor.familyId,
        status: SanctionInstanceStatus.PROPOSED,
      },
      data: {
        status: SanctionInstanceStatus.IGNORED,
        ignoredAt: new Date(),
        ignoredById: actor.membershipId,
      },
    });
    if (updated.count === 0) return { status: instance.status, alreadyDecided: true };

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.SANCTION_IGNORED,
      summary: `${actor.displayName} ignore la sanction proposee « ${instance.titleSnapshot} » pour ${instance.child.user.displayName}.`,
      targetType: 'SanctionInstance',
      targetId: sanctionInstanceId,
      metadata: {
        sanctionInstanceId,
        childMembershipId: instance.childMembershipId,
        childName: instance.child.user.displayName,
      },
    });

    return { status: SanctionInstanceStatus.IGNORED, alreadyDecided: false };
  });
};

/**
 * Le parent leve une sanction.
 *
 * Autorise depuis ACTIVE comme depuis LIFT_ELIGIBLE : l'autorite parentale
 * prime toujours sur la condition automatique. Atteindre la condition ne leve
 * jamais la sanction tout seul.
 */
export const liftSanction = async (
  actor: FamilyActor,
  sanctionInstanceId: string,
  note: string | null = null,
): Promise<SanctionDecisionResult> => {
  requireCapability(actor, ParentPermission.SANCTION_LIFT);

  return prisma.$transaction(async (tx) => {
    const instance = await tx.sanctionInstance.findFirst({
      where: { id: sanctionInstanceId, familyId: actor.familyId },
      select: {
        id: true,
        status: true,
        titleSnapshot: true,
        childMembershipId: true,
        child: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (instance === null) throw notFoundError('Cette sanction est introuvable.');

    const updated = await tx.sanctionInstance.updateMany({
      where: {
        id: sanctionInstanceId,
        familyId: actor.familyId,
        status: { in: [SanctionInstanceStatus.ACTIVE, SanctionInstanceStatus.LIFT_ELIGIBLE] },
      },
      data: {
        status: SanctionInstanceStatus.LIFTED,
        liftedAt: new Date(),
        liftedById: actor.membershipId,
      },
    });
    if (updated.count === 0) return { status: instance.status, alreadyDecided: true };

    const childName = instance.child.user.displayName;
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.SANCTION_LIFTED,
      summary: `${actor.displayName} leve la sanction « ${instance.titleSnapshot} » pour ${childName}.`,
      targetType: 'SanctionInstance',
      targetId: sanctionInstanceId,
      metadata: {
        sanctionInstanceId,
        childMembershipId: instance.childMembershipId,
        childName,
        ...(note !== null ? { reason: note } : {}),
      },
    });

    await notify(tx, {
      familyId: actor.familyId,
      recipientMembershipId: instance.childMembershipId,
      kind: NotificationKind.SANCTION_LIFTED,
      title: 'Sanction levee',
      body: `${actor.displayName} a leve « ${instance.titleSnapshot} ».`,
      linkPath: '/enfant/sanctions',
      dedupeKey: `sanction-lifted:${sanctionInstanceId}`,
    });

    return { status: SanctionInstanceStatus.LIFTED, alreadyDecided: false };
  });
};
