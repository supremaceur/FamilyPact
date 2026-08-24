/**
 * Taches : machine d'etat et recurrence.
 *
 * Invariant central : AUCUNE transition n'ecrit de points par elle-meme.
 * Seules deux transitions autorisent une ecriture au ledger, et toutes deux
 * exigent une decision explicite d'un parent :
 *   CLAIMED_DONE          --approve--> APPROVED        (+pointsAward)
 *   MISSED_PENDING_REVIEW --confirm--> MISSED_CONFIRMED (-pointsPenalty)
 *
 * Le depassement d'echeance ne fait que produire MISSED_PENDING_REVIEW : il ne
 * retire jamais de points.
 */

import { TaskOccurrenceState, TaskRecurrence } from '@/generated/prisma/enums';
import { invalidStateError, validationError } from './errors';
import {
  addLocalDays,
  compareLocalDates,
  isoWeekday,
  isLocalDate,
  isLocalTime,
  localDateTimeToInstant,
  type LocalDate,
  type LocalTime,
} from './time';

export { TaskOccurrenceState, TaskRecurrence };

export type TaskAction =
  'CLAIM_DONE' | 'APPROVE' | 'REJECT' | 'DETECT_MISSED' | 'CONFIRM_MISSED' | 'IGNORE_MISSED';

/** Transitions autorisees, indexees par etat de depart. */
const TRANSITIONS: Readonly<
  Record<TaskOccurrenceState, Readonly<Partial<Record<TaskAction, TaskOccurrenceState>>>>
> = {
  TODO: {
    CLAIM_DONE: TaskOccurrenceState.CLAIMED_DONE,
    DETECT_MISSED: TaskOccurrenceState.MISSED_PENDING_REVIEW,
  },
  CLAIMED_DONE: {
    APPROVE: TaskOccurrenceState.APPROVED,
    REJECT: TaskOccurrenceState.REJECTED,
  },
  // Une tache refusee retombe a faire : l'enfant peut la re-declarer terminee,
  // et l'echeance depassee reste detectable.
  REJECTED: {
    CLAIM_DONE: TaskOccurrenceState.CLAIMED_DONE,
    DETECT_MISSED: TaskOccurrenceState.MISSED_PENDING_REVIEW,
  },
  MISSED_PENDING_REVIEW: {
    CONFIRM_MISSED: TaskOccurrenceState.MISSED_CONFIRMED,
    IGNORE_MISSED: TaskOccurrenceState.MISSED_IGNORED,
  },
  APPROVED: {},
  MISSED_CONFIRMED: {},
  MISSED_IGNORED: {},
};

export const TERMINAL_TASK_STATES: ReadonlySet<TaskOccurrenceState> = new Set([
  TaskOccurrenceState.APPROVED,
  TaskOccurrenceState.MISSED_CONFIRMED,
  TaskOccurrenceState.MISSED_IGNORED,
]);

/** Etats qui reclament une decision parentale. */
export const PARENT_DECISION_STATES: ReadonlySet<TaskOccurrenceState> = new Set([
  TaskOccurrenceState.CLAIMED_DONE,
  TaskOccurrenceState.MISSED_PENDING_REVIEW,
]);

export const canTransition = (state: TaskOccurrenceState, action: TaskAction): boolean =>
  TRANSITIONS[state][action] !== undefined;

/** Applique une transition, ou echoue si elle n'est pas autorisee. */
export const applyTransition = (
  state: TaskOccurrenceState,
  action: TaskAction,
): TaskOccurrenceState => {
  const next = TRANSITIONS[state][action];
  if (next === undefined) {
    throw invalidStateError(`Transition impossible : ${action} depuis l'etat ${state}.`, {
      state,
      action,
    });
  }
  return next;
};

/** Effet sur le ledger d'une transition. Aucune autre transition n'en produit. */
export const ledgerEffectOf = (
  action: TaskAction,
  points: { readonly award: number; readonly penalty: number },
): number | null => {
  switch (action) {
    case 'APPROVE':
      return points.award > 0 ? points.award : null;
    case 'CONFIRM_MISSED':
      return points.penalty > 0 ? -points.penalty : null;
    case 'CLAIM_DONE':
    case 'REJECT':
    case 'DETECT_MISSED':
    case 'IGNORE_MISSED':
      return null;
  }
};

export const TASK_STATE_LABELS: Readonly<Record<TaskOccurrenceState, string>> = {
  TODO: 'A faire',
  CLAIMED_DONE: 'En attente de validation',
  APPROVED: 'Validee',
  REJECTED: 'Refusee',
  MISSED_PENDING_REVIEW: 'Echeance depassee',
  MISSED_CONFIRMED: 'Non realisee — confirmee',
  MISSED_IGNORED: 'Non realisee — ignoree',
};

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

export interface RecurrenceSpec {
  readonly recurrence: TaskRecurrence;
  /** Date locale de premiere application (incluse). */
  readonly startDate: LocalDate;
  /** Date locale de derniere application (incluse), ou null si sans fin. */
  readonly endDate: LocalDate | null;
  /** Jours ISO 1..7 pour WEEKLY_DAYS. */
  readonly weekdays: readonly number[];
  /** Heure limite locale pour les recurrences. */
  readonly dueTime: LocalTime | null;
  /** Echeance absolue pour ONE_OFF. */
  readonly dueAt: Date | null;
}

export const assertRecurrenceIsValid = (spec: RecurrenceSpec): void => {
  if (!isLocalDate(spec.startDate)) {
    throw validationError("La date d'effet est invalide.");
  }
  if (spec.endDate !== null) {
    if (!isLocalDate(spec.endDate)) {
      throw validationError('La date de fin est invalide.');
    }
    if (compareLocalDates(spec.endDate, spec.startDate) < 0) {
      throw validationError("La date de fin ne peut pas preceder la date d'effet.");
    }
  }

  switch (spec.recurrence) {
    case TaskRecurrence.ONE_OFF:
      if (spec.dueAt === null) {
        throw validationError('Une tache ponctuelle doit avoir une echeance.');
      }
      break;
    case TaskRecurrence.DAILY:
      if (spec.dueTime === null || !isLocalTime(spec.dueTime)) {
        throw validationError('Une tache quotidienne doit avoir une heure limite.');
      }
      break;
    case TaskRecurrence.WEEKLY_DAYS:
      if (spec.dueTime === null || !isLocalTime(spec.dueTime)) {
        throw validationError('Une tache hebdomadaire doit avoir une heure limite.');
      }
      if (spec.weekdays.length === 0) {
        throw validationError('Choisissez au moins un jour de la semaine.');
      }
      if (spec.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
        throw validationError('Jour de la semaine invalide.');
      }
      if (new Set(spec.weekdays).size !== spec.weekdays.length) {
        throw validationError('Un jour de la semaine est selectionne deux fois.');
      }
      break;
  }
};

/** La recurrence produit-elle une occurrence a cette date locale ? */
export const occursOn = (spec: RecurrenceSpec, date: LocalDate): boolean => {
  if (compareLocalDates(date, spec.startDate) < 0) return false;
  if (spec.endDate !== null && compareLocalDates(date, spec.endDate) > 0) return false;

  switch (spec.recurrence) {
    case TaskRecurrence.ONE_OFF:
      // L'unique occurrence porte la date d'effet ; `dueAt` fixe l'echeance.
      return date === spec.startDate;
    case TaskRecurrence.DAILY:
      return true;
    case TaskRecurrence.WEEKLY_DAYS:
      return spec.weekdays.includes(isoWeekday(date));
  }
};

export interface PlannedOccurrence {
  readonly occurrenceDate: LocalDate;
  readonly dueAt: Date;
}

/**
 * Enumere les occurrences a materialiser entre deux dates locales incluses.
 *
 * La generation est idempotente : c'est la contrainte unique
 * `(taskDefinitionId, occurrenceDate)` qui absorbe les rejeux, et non un
 * quelconque etat conserve par le job.
 */
export const planOccurrences = (
  spec: RecurrenceSpec,
  fromDate: LocalDate,
  toDate: LocalDate,
  timeZone: string,
): readonly PlannedOccurrence[] => {
  assertRecurrenceIsValid(spec);
  if (compareLocalDates(fromDate, toDate) > 0) return [];

  const planned: PlannedOccurrence[] = [];
  let cursor = compareLocalDates(fromDate, spec.startDate) < 0 ? spec.startDate : fromDate;

  // Garde-fou : une fenetre de generation reste bornee (cf. jobs planifies).
  let guard = 0;
  while (compareLocalDates(cursor, toDate) <= 0 && guard < MAX_PLANNING_DAYS) {
    guard += 1;
    if (occursOn(spec, cursor)) {
      planned.push({
        occurrenceDate: cursor,
        dueAt:
          spec.recurrence === TaskRecurrence.ONE_OFF
            ? (spec.dueAt as Date)
            : localDateTimeToInstant(cursor, spec.dueTime as LocalTime, timeZone),
      });
    }
    cursor = addLocalDays(cursor, 1);
  }
  return planned;
};

/** Deux ans : au-dela, la generation reste du ressort d'un job ulterieur. */
export const MAX_PLANNING_DAYS = 750;

export const RECURRENCE_LABELS: Readonly<Record<TaskRecurrence, string>> = {
  ONE_OFF: 'Ponctuelle',
  DAILY: 'Tous les jours',
  WEEKLY_DAYS: 'Certains jours',
};

export const WEEKDAY_LABELS: readonly string[] = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
];

export const WEEKDAY_SHORT_LABELS: readonly string[] = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
