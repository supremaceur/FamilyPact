import 'server-only';

import {
  AuditAction,
  NotificationKind,
  ParentPermission,
  PointTransactionSource,
  PointTransactionType,
  TaskDefinitionStatus,
  TaskOccurrenceState,
} from '@/generated/prisma/enums';
import { conflictError, notFoundError } from '@/domain/errors';
import { applyTransition, planOccurrences, type TaskAction } from '@/domain/tasks';
import { addLocalDays, toLocalDate } from '@/domain/time';
import { recordAudit } from '@/server/audit/audit-log';
import { requireCapability, type FamilyActor } from '@/server/auth/context';
import { prisma, type Db } from '@/server/db/prisma';
import { notify, notifyCapableParents } from '@/server/notifications/notify';
import { applyScoreChange } from './scoring';

/**
 * Occurrences de taches : generation, declaration par l'enfant, decisions
 * parentales.
 *
 * Deux invariants gouvernent ce module :
 *   1. seul un parent habilite fait bouger le ledger ;
 *   2. chaque transition est idempotente — deux clics simultanes produisent
 *      exactement un effet.
 *
 * L'idempotence repose sur des mises a jour CONDITIONNELLES : la clause WHERE
 * porte sur l'etat attendu, donc la deuxieme requete concurrente ne met a jour
 * aucune ligne et le service le detecte.
 */

/** Horizon de generation : 30 jours d'avance suffisent a une famille. */
export const OCCURRENCE_HORIZON_DAYS = 30;

/** Etats depuis lesquels un enfant peut declarer une tache terminee. */
const CLAIMABLE_STATES: ReadonlySet<TaskOccurrenceState> = new Set([
  TaskOccurrenceState.TODO,
  TaskOccurrenceState.REJECTED,
]);

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Materialise les occurrences d'un modele jusqu'a l'horizon.
 *
 * Idempotent : la contrainte unique `(taskDefinitionId, occurrenceDate)` absorbe
 * les rejeux, `skipDuplicates` evite de faire echouer le lot pour autant.
 */
export const generateOccurrencesForDefinition = async (
  tx: Db,
  params: {
    readonly familyId: string;
    readonly taskDefinitionId: string;
    readonly timeZone: string;
    readonly now?: Date;
    readonly horizonDays?: number;
  },
): Promise<number> => {
  const now = params.now ?? new Date();
  const definition = await tx.taskDefinition.findFirst({
    where: { id: params.taskDefinitionId, familyId: params.familyId },
    select: {
      id: true,
      childMembershipId: true,
      title: true,
      pointsAward: true,
      pointsPenalty: true,
      recurrence: true,
      startDate: true,
      endDate: true,
      dueTime: true,
      dueAt: true,
      weekdays: true,
      status: true,
      version: true,
    },
  });
  if (definition === null) return 0;
  if (definition.status !== TaskDefinitionStatus.ACTIVE) return 0;

  const today = toLocalDate(now, params.timeZone);
  const horizon = addLocalDays(today, params.horizonDays ?? OCCURRENCE_HORIZON_DAYS);

  const planned = planOccurrences(
    {
      recurrence: definition.recurrence,
      startDate: definition.startDate,
      endDate: definition.endDate,
      weekdays: definition.weekdays,
      dueTime: definition.dueTime,
      dueAt: definition.dueAt,
    },
    // On ne genere jamais retroactivement : une tache creee aujourd'hui ne fait
    // pas apparaitre des echeances deja manquees hier.
    today,
    horizon,
    params.timeZone,
  );

  if (planned.length === 0) return 0;

  const result = await tx.taskOccurrence.createMany({
    data: planned.map((occurrence) => ({
      familyId: params.familyId,
      taskDefinitionId: definition.id,
      childMembershipId: definition.childMembershipId,
      occurrenceDate: occurrence.occurrenceDate,
      dueAt: occurrence.dueAt,
      titleSnapshot: definition.title,
      pointsAwardSnapshot: definition.pointsAward,
      pointsPenaltySnapshot: definition.pointsPenalty,
      definitionVersion: definition.version,
    })),
    skipDuplicates: true,
  });

  return result.count;
};

// ---------------------------------------------------------------------------
// Declaration par l'enfant
// ---------------------------------------------------------------------------

export interface OccurrenceDecisionResult {
  readonly state: TaskOccurrenceState;
  /** Vrai si la decision avait deja ete prise : l'appelant n'agit pas deux fois. */
  readonly alreadyDecided: boolean;
  readonly balanceBefore?: number;
  readonly balanceAfter?: number;
}

/**
 * L'enfant declare la tache terminee.
 *
 * Cette action ne cree AUCUNE transaction de points : elle place seulement
 * l'occurrence en attente d'une decision parentale.
 */
export const claimOccurrenceDone = async (
  actor: FamilyActor,
  occurrenceId: string,
): Promise<OccurrenceDecisionResult> => {
  return prisma.$transaction(async (tx) => {
    const occurrence = await tx.taskOccurrence.findFirst({
      where: {
        id: occurrenceId,
        familyId: actor.familyId,
        // Un enfant ne peut declarer que SES taches.
        childMembershipId: actor.membershipId,
      },
      select: { id: true, state: true, titleSnapshot: true, pointsAwardSnapshot: true },
    });
    if (occurrence === null) throw notFoundError('Cette tache est introuvable.');

    // Deja declaree, ou deja tranchee par un parent : on le signale sans lever
    // d'erreur. Un double appui ne doit pas ressembler a une panne.
    if (!CLAIMABLE_STATES.has(occurrence.state)) {
      return { state: occurrence.state, alreadyDecided: true };
    }

    const nextState = applyTransition(occurrence.state, 'CLAIM_DONE');

    const updated = await tx.taskOccurrence.updateMany({
      where: {
        id: occurrenceId,
        familyId: actor.familyId,
        state: { in: [TaskOccurrenceState.TODO, TaskOccurrenceState.REJECTED] },
      },
      data: { state: nextState, claimedAt: new Date(), claimedByUserId: actor.userId },
    });
    if (updated.count === 0) {
      return { state: occurrence.state, alreadyDecided: true };
    }

    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.TASK_CLAIMED,
      summary: `${actor.displayName} declare avoir termine « ${occurrence.titleSnapshot} ».`,
      targetType: 'TaskOccurrence',
      targetId: occurrenceId,
      metadata: {
        taskOccurrenceId: occurrenceId,
        taskTitle: occurrence.titleSnapshot,
        childMembershipId: actor.membershipId,
        childName: actor.displayName,
      },
    });

    await notifyCapableParents(tx, {
      familyId: actor.familyId,
      capability: ParentPermission.TASK_APPROVE,
      dedupeKeyPrefix: `task-claimed:${occurrenceId}`,
      draft: {
        kind: NotificationKind.TASK_CLAIM_PENDING,
        title: 'Une tache attend votre validation',
        body: `${actor.displayName} indique avoir termine « ${occurrence.titleSnapshot} » (+${occurrence.pointsAwardSnapshot} points).`,
        linkPath: '/parent/validations',
      },
    });

    return { state: nextState, alreadyDecided: false };
  });
};

// ---------------------------------------------------------------------------
// Decisions parentales
// ---------------------------------------------------------------------------

interface DecisionContext {
  readonly occurrenceId: string;
  readonly action: TaskAction;
  readonly capability: ParentPermission;
  readonly expectedStates: readonly TaskOccurrenceState[];
  readonly note: string | null;
}

const loadDecidableOccurrence = async (
  tx: Db,
  familyId: string,
  occurrenceId: string,
): Promise<{
  readonly id: string;
  readonly state: TaskOccurrenceState;
  readonly titleSnapshot: string;
  readonly pointsAwardSnapshot: number;
  readonly pointsPenaltySnapshot: number;
  readonly childMembershipId: string;
  readonly childName: string;
}> => {
  const occurrence = await tx.taskOccurrence.findFirst({
    where: { id: occurrenceId, familyId },
    select: {
      id: true,
      state: true,
      titleSnapshot: true,
      pointsAwardSnapshot: true,
      pointsPenaltySnapshot: true,
      childMembershipId: true,
      child: { select: { user: { select: { displayName: true } } } },
    },
  });
  if (occurrence === null) throw notFoundError('Cette tache est introuvable.');
  return {
    id: occurrence.id,
    state: occurrence.state,
    titleSnapshot: occurrence.titleSnapshot,
    pointsAwardSnapshot: occurrence.pointsAwardSnapshot,
    pointsPenaltySnapshot: occurrence.pointsPenaltySnapshot,
    childMembershipId: occurrence.childMembershipId,
    childName: occurrence.child.user.displayName,
  };
};

/**
 * Applique une decision parentale.
 *
 * Deux protections distinctes, pour deux situations distinctes :
 *
 *   - DECISION DEJA PRISE (l'autre parent a valide il y a une minute, ou le
 *     bouton a ete clique deux fois) : l'etat courant n'est plus attendu, et
 *     l'appel devient un no-op signale a l'interface. Ce n'est pas une erreur —
 *     le parent n'a rien fait de mal — et le message doit rester comprehensible,
 *     jamais une transition technique.
 *
 *   - DECISION SIMULTANEE (les deux parents cliquent au meme instant) : les
 *     deux transactions lisent l'etat attendu, mais `updateMany` est conditionne
 *     a cet etat et prend un verrou de ligne. La seconde ne met a jour aucune
 *     ligne. Combine a l'unicite du ledger, cela garantit qu'une occurrence ne
 *     peut jamais etre creditee deux fois.
 */
const decideOccurrence = async (
  actor: FamilyActor,
  context: DecisionContext,
): Promise<OccurrenceDecisionResult> => {
  requireCapability(actor, context.capability);

  return prisma.$transaction(async (tx) => {
    const occurrence = await loadDecidableOccurrence(tx, actor.familyId, context.occurrenceId);

    // La decision a deja ete prise : on le dit, plutot que de lever une erreur
    // de transition que l'utilisateur ne pourrait pas interpreter.
    if (!context.expectedStates.includes(occurrence.state)) {
      return { state: occurrence.state, alreadyDecided: true };
    }

    const nextState = applyTransition(occurrence.state, context.action);
    const now = new Date();

    const updated = await tx.taskOccurrence.updateMany({
      where: {
        id: context.occurrenceId,
        familyId: actor.familyId,
        state: { in: [...context.expectedStates] },
      },
      data: {
        state: nextState,
        decidedAt: now,
        decidedById: actor.membershipId,
        decisionNote: context.note,
      },
    });
    if (updated.count === 0) {
      const current = await loadDecidableOccurrence(tx, actor.familyId, context.occurrenceId);
      return { state: current.state, alreadyDecided: true };
    }

    let balanceBefore: number | undefined;
    let balanceAfter: number | undefined;

    if (context.action === 'APPROVE' && occurrence.pointsAwardSnapshot > 0) {
      const applied = await applyScoreChange(tx, {
        familyId: actor.familyId,
        childMembershipId: occurrence.childMembershipId,
        childName: occurrence.childName,
        delta: occurrence.pointsAwardSnapshot,
        type: PointTransactionType.TASK_APPROVED,
        sourceType: PointTransactionSource.TASK_OCCURRENCE,
        sourceId: occurrence.id,
        label: occurrence.titleSnapshot,
        reason: null,
        reversesTransactionId: null,
        approvedByMembershipId: actor.membershipId,
        effectiveAt: now,
        now,
      });
      balanceBefore = applied.balanceBefore;
      balanceAfter = applied.balanceAfter;
    }

    // Refus assorti du retrait configure. Le type de mouvement est distinct de
    // TASK_MISSED : l'index unique (sourceType, sourceId, type) reste donc
    // independant entre les deux, et l'historique garde les deux histoires
    // separees — un refus n'est pas une echeance laissee passer.
    if (context.action === 'REJECT_WITH_PENALTY' && occurrence.pointsPenaltySnapshot > 0) {
      const applied = await applyScoreChange(tx, {
        familyId: actor.familyId,
        childMembershipId: occurrence.childMembershipId,
        childName: occurrence.childName,
        delta: -occurrence.pointsPenaltySnapshot,
        type: PointTransactionType.TASK_REJECTED,
        sourceType: PointTransactionSource.TASK_OCCURRENCE,
        sourceId: occurrence.id,
        label: `${occurrence.titleSnapshot} — refusee`,
        reason: context.note,
        reversesTransactionId: null,
        approvedByMembershipId: actor.membershipId,
        effectiveAt: now,
        now,
      });
      balanceBefore = applied.balanceBefore;
      balanceAfter = applied.balanceAfter;
    }

    if (context.action === 'CONFIRM_MISSED' && occurrence.pointsPenaltySnapshot > 0) {
      const applied = await applyScoreChange(tx, {
        familyId: actor.familyId,
        childMembershipId: occurrence.childMembershipId,
        childName: occurrence.childName,
        delta: -occurrence.pointsPenaltySnapshot,
        type: PointTransactionType.TASK_MISSED,
        sourceType: PointTransactionSource.TASK_OCCURRENCE,
        sourceId: occurrence.id,
        label: `${occurrence.titleSnapshot} — non realisee`,
        reason: null,
        reversesTransactionId: null,
        approvedByMembershipId: actor.membershipId,
        effectiveAt: now,
        now,
      });
      balanceBefore = applied.balanceBefore;
      balanceAfter = applied.balanceAfter;
    }

    const auditAction = AUDIT_ACTION_BY_TASK_ACTION[context.action];
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: auditAction,
      summary: buildDecisionSummary(actor.displayName, occurrence, context.action),
      targetType: 'TaskOccurrence',
      targetId: context.occurrenceId,
      metadata: {
        taskOccurrenceId: context.occurrenceId,
        taskTitle: occurrence.titleSnapshot,
        childMembershipId: occurrence.childMembershipId,
        childName: occurrence.childName,
        previousState: occurrence.state,
        state: nextState,
        ...(balanceBefore !== undefined ? { balanceBefore } : {}),
        ...(balanceAfter !== undefined ? { balanceAfter } : {}),
        ...(context.note !== null ? { reason: context.note } : {}),
      },
    });

    const childNotification = CHILD_NOTIFICATION_BY_TASK_ACTION[context.action];
    if (childNotification !== null) {
      await notify(tx, {
        familyId: actor.familyId,
        recipientMembershipId: occurrence.childMembershipId,
        kind: childNotification.kind,
        title: childNotification.title,
        body: childNotification.body(occurrence, actor.displayName),
        linkPath: '/enfant/taches',
        dedupeKey: `${context.action}:${context.occurrenceId}`,
      });
    }

    return {
      state: nextState,
      alreadyDecided: false,
      ...(balanceBefore !== undefined ? { balanceBefore } : {}),
      ...(balanceAfter !== undefined ? { balanceAfter } : {}),
    };
  });
};

type DecidableOccurrence = Awaited<ReturnType<typeof loadDecidableOccurrence>>;

const AUDIT_ACTION_BY_TASK_ACTION: Readonly<Record<TaskAction, AuditAction>> = {
  CLAIM_DONE: AuditAction.TASK_CLAIMED,
  APPROVE: AuditAction.TASK_APPROVED,
  REJECT: AuditAction.TASK_REJECTED,
  REJECT_WITH_PENALTY: AuditAction.TASK_REJECTED_WITH_PENALTY,
  DETECT_MISSED: AuditAction.TASK_MISSED_DETECTED,
  CONFIRM_MISSED: AuditAction.TASK_MISSED_CONFIRMED,
  IGNORE_MISSED: AuditAction.TASK_MISSED_IGNORED,
};

const CHILD_NOTIFICATION_BY_TASK_ACTION: Readonly<
  Record<
    TaskAction,
    {
      readonly kind: NotificationKind;
      readonly title: string;
      readonly body: (occurrence: DecidableOccurrence, parentName: string) => string;
    } | null
  >
> = {
  CLAIM_DONE: null,
  DETECT_MISSED: null,
  APPROVE: {
    kind: NotificationKind.TASK_APPROVED,
    title: 'Tache validee',
    body: (occurrence, parentName) =>
      `${parentName} a valide « ${occurrence.titleSnapshot} » : +${occurrence.pointsAwardSnapshot} points.`,
  },
  REJECT: {
    kind: NotificationKind.TASK_REJECTED,
    title: 'Tache refusee',
    body: (occurrence, parentName) =>
      `${parentName} n'a pas valide « ${occurrence.titleSnapshot} ». Aucun point n'a ete retire.`,
  },
  REJECT_WITH_PENALTY: {
    kind: NotificationKind.TASK_REJECTED_WITH_PENALTY,
    title: 'Tache refusee — points retires',
    body: (occurrence, parentName) =>
      `${parentName} n'a pas valide « ${occurrence.titleSnapshot} » : -${occurrence.pointsPenaltySnapshot} points.`,
  },
  CONFIRM_MISSED: {
    kind: NotificationKind.TASK_MISSED_CONFIRMED,
    title: 'Tache non realisee',
    body: (occurrence, parentName) =>
      `${parentName} a confirme que « ${occurrence.titleSnapshot} » n'a pas ete faite : -${occurrence.pointsPenaltySnapshot} points.`,
  },
  IGNORE_MISSED: {
    kind: NotificationKind.TASK_MISSED_CONFIRMED,
    title: 'Tache non realisee — sans consequence',
    body: (occurrence, parentName) =>
      `${parentName} a choisi de ne retirer aucun point pour « ${occurrence.titleSnapshot} ».`,
  },
};

const buildDecisionSummary = (
  parentName: string,
  occurrence: DecidableOccurrence,
  action: TaskAction,
): string => {
  switch (action) {
    case 'APPROVE':
      return `${parentName} valide « ${occurrence.titleSnapshot} » pour ${occurrence.childName} : +${occurrence.pointsAwardSnapshot} points.`;
    case 'REJECT':
      return `${parentName} refuse « ${occurrence.titleSnapshot} » pour ${occurrence.childName}. Aucun point retire.`;
    case 'REJECT_WITH_PENALTY':
      return `${parentName} refuse « ${occurrence.titleSnapshot} » pour ${occurrence.childName} : -${occurrence.pointsPenaltySnapshot} points.`;
    case 'CONFIRM_MISSED':
      return `${parentName} confirme « ${occurrence.titleSnapshot} » non realisee pour ${occurrence.childName} : -${occurrence.pointsPenaltySnapshot} points.`;
    case 'IGNORE_MISSED':
      return `${parentName} ignore « ${occurrence.titleSnapshot} » non realisee pour ${occurrence.childName}. Aucun point retire.`;
    case 'CLAIM_DONE':
      return `${occurrence.childName} declare « ${occurrence.titleSnapshot} » terminee.`;
    case 'DETECT_MISSED':
      return `Echeance depassee pour « ${occurrence.titleSnapshot} » (${occurrence.childName}).`;
  }
};

export const approveOccurrence = (
  actor: FamilyActor,
  occurrenceId: string,
  note: string | null = null,
): Promise<OccurrenceDecisionResult> =>
  decideOccurrence(actor, {
    occurrenceId,
    action: 'APPROVE',
    capability: ParentPermission.TASK_APPROVE,
    expectedStates: [TaskOccurrenceState.CLAIMED_DONE],
    note,
  });

export const rejectOccurrence = (
  actor: FamilyActor,
  occurrenceId: string,
  note: string | null = null,
): Promise<OccurrenceDecisionResult> =>
  decideOccurrence(actor, {
    occurrenceId,
    action: 'REJECT',
    capability: ParentPermission.TASK_APPROVE,
    expectedStates: [TaskOccurrenceState.CLAIMED_DONE],
    note,
  });

/**
 * Refus assorti du retrait deja configure sur la tache.
 *
 * Le parent ne saisit aucun montant : il applique, ou non, une consequence
 * convenue en amont. C'est la meme capacite que le refus simple — decider
 * qu'une tache n'est pas validee — avec la consequence que la famille avait
 * prevue.
 */
export const rejectOccurrenceWithPenalty = (
  actor: FamilyActor,
  occurrenceId: string,
  note: string | null = null,
): Promise<OccurrenceDecisionResult> =>
  decideOccurrence(actor, {
    occurrenceId,
    action: 'REJECT_WITH_PENALTY',
    capability: ParentPermission.TASK_APPROVE,
    expectedStates: [TaskOccurrenceState.CLAIMED_DONE],
    note,
  });

export const confirmMissedOccurrence = (
  actor: FamilyActor,
  occurrenceId: string,
  note: string | null = null,
): Promise<OccurrenceDecisionResult> =>
  decideOccurrence(actor, {
    occurrenceId,
    action: 'CONFIRM_MISSED',
    capability: ParentPermission.TASK_CONFIRM_MISSED,
    expectedStates: [TaskOccurrenceState.MISSED_PENDING_REVIEW],
    note,
  });

export const ignoreMissedOccurrence = (
  actor: FamilyActor,
  occurrenceId: string,
  note: string | null = null,
): Promise<OccurrenceDecisionResult> =>
  decideOccurrence(actor, {
    occurrenceId,
    action: 'IGNORE_MISSED',
    capability: ParentPermission.TASK_CONFIRM_MISSED,
    expectedStates: [TaskOccurrenceState.MISSED_PENDING_REVIEW],
    note,
  });

// ---------------------------------------------------------------------------
// Detection des echeances depassees (job planifie)
// ---------------------------------------------------------------------------

/**
 * Marque les occurrences dont l'echeance est passee comme
 * MISSED_PENDING_REVIEW.
 *
 * AUCUN POINT N'EST RETIRE ICI. C'est la regle la plus importante du produit :
 * le systeme detecte, le parent decide. Le retrait n'a lieu que si un parent
 * confirme explicitement (voir `confirmMissedOccurrence`).
 */
export const detectMissedOccurrences = async (
  db: Db,
  params: { readonly now?: Date; readonly familyId?: string } = {},
): Promise<number> => {
  const now = params.now ?? new Date();

  const candidates = await db.taskOccurrence.findMany({
    where: {
      ...(params.familyId !== undefined ? { familyId: params.familyId } : {}),
      state: { in: [TaskOccurrenceState.TODO, TaskOccurrenceState.REJECTED] },
      dueAt: { lt: now },
    },
    select: {
      id: true,
      familyId: true,
      titleSnapshot: true,
      pointsPenaltySnapshot: true,
      childMembershipId: true,
      child: { select: { user: { select: { displayName: true } } } },
    },
    take: 500,
  });

  let processed = 0;
  for (const candidate of candidates) {
    const updated = await db.taskOccurrence.updateMany({
      where: {
        id: candidate.id,
        state: { in: [TaskOccurrenceState.TODO, TaskOccurrenceState.REJECTED] },
      },
      data: { state: TaskOccurrenceState.MISSED_PENDING_REVIEW, missedDetectedAt: now },
    });
    if (updated.count === 0) continue;
    processed += 1;

    const childName = candidate.child.user.displayName;
    await recordAudit(db, {
      familyId: candidate.familyId,
      action: AuditAction.TASK_MISSED_DETECTED,
      summary: `Echeance depassee : « ${candidate.titleSnapshot} » (${childName}). Retrait prevu : -${candidate.pointsPenaltySnapshot} points, en attente de decision parentale.`,
      targetType: 'TaskOccurrence',
      targetId: candidate.id,
      metadata: {
        taskOccurrenceId: candidate.id,
        taskTitle: candidate.titleSnapshot,
        childMembershipId: candidate.childMembershipId,
        childName,
        delta: -candidate.pointsPenaltySnapshot,
      },
    });

    await notifyCapableParents(db, {
      familyId: candidate.familyId,
      capability: ParentPermission.TASK_CONFIRM_MISSED,
      dedupeKeyPrefix: `task-missed:${candidate.id}`,
      draft: {
        kind: NotificationKind.TASK_MISSED_PENDING,
        title: 'Une tache a depasse son echeance',
        body: `« ${candidate.titleSnapshot} » (${childName}) n'a pas ete declaree terminee. Retrait prevu : -${candidate.pointsPenaltySnapshot} points.`,
        linkPath: '/parent/validations',
      },
    });
  }

  return processed;
};

export { conflictError };
