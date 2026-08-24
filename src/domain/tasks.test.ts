import { describe, expect, it } from 'vitest';
import { TaskOccurrenceState, TaskRecurrence } from '@/generated/prisma/enums';
import { DomainError } from './errors';
import {
  applyTransition,
  assertRecurrenceIsValid,
  canTransition,
  ledgerEffectOf,
  occursOn,
  planOccurrences,
  type RecurrenceSpec,
} from './tasks';

const PARIS = 'Europe/Paris';

const spec = (overrides: Partial<RecurrenceSpec> = {}): RecurrenceSpec => ({
  recurrence: TaskRecurrence.DAILY,
  startDate: '2026-08-24',
  endDate: null,
  weekdays: [],
  dueTime: '19:00',
  dueAt: null,
  ...overrides,
});

describe("machine d'etat des taches", () => {
  it('suit le parcours nominal : a faire → declaree → validee', () => {
    expect(applyTransition(TaskOccurrenceState.TODO, 'CLAIM_DONE')).toBe(
      TaskOccurrenceState.CLAIMED_DONE,
    );
    expect(applyTransition(TaskOccurrenceState.CLAIMED_DONE, 'APPROVE')).toBe(
      TaskOccurrenceState.APPROVED,
    );
  });

  it('permet de refuser, et la tache redevient declarable', () => {
    expect(applyTransition(TaskOccurrenceState.CLAIMED_DONE, 'REJECT')).toBe(
      TaskOccurrenceState.REJECTED,
    );
    expect(applyTransition(TaskOccurrenceState.REJECTED, 'CLAIM_DONE')).toBe(
      TaskOccurrenceState.CLAIMED_DONE,
    );
  });

  it('offre deux refus : le meme etat, deux consequences differentes', () => {
    const points = { award: 20, penalty: 10 };

    // Les deux refus menent au MEME etat : la tache n'a pas ete validee, et
    // l'enfant peut la redeclarer dans les deux cas.
    expect(applyTransition(TaskOccurrenceState.CLAIMED_DONE, 'REJECT_WITH_PENALTY')).toBe(
      TaskOccurrenceState.REJECTED,
    );
    expect(applyTransition(TaskOccurrenceState.REJECTED, 'CLAIM_DONE')).toBe(
      TaskOccurrenceState.CLAIMED_DONE,
    );

    // Seule la consequence sur les points les distingue.
    expect(ledgerEffectOf('REJECT', points)).toBeNull();
    expect(ledgerEffectOf('REJECT_WITH_PENALTY', points)).toBe(-10);
  });

  it('applique au refus le retrait configure sur la tache, jamais un autre', () => {
    // Le parent ne saisit aucun montant : c'est celui de la tache qui s'applique.
    expect(ledgerEffectOf('REJECT_WITH_PENALTY', { award: 20, penalty: 35 })).toBe(-35);
    // Sans retrait configure, le refus avec retrait n'ecrit rien : l'interface
    // ne propose d'ailleurs pas le bouton dans ce cas.
    expect(ledgerEffectOf('REJECT_WITH_PENALTY', { award: 20, penalty: 0 })).toBeNull();
  });

  it("interdit de refuser une tache qui n'a pas ete declaree terminee", () => {
    expect(canTransition(TaskOccurrenceState.TODO, 'REJECT_WITH_PENALTY')).toBe(false);
    expect(canTransition(TaskOccurrenceState.MISSED_PENDING_REVIEW, 'REJECT_WITH_PENALTY')).toBe(
      false,
    );
    expect(canTransition(TaskOccurrenceState.APPROVED, 'REJECT_WITH_PENALTY')).toBe(false);
  });

  it('place une echeance depassee en attente de decision, sans retirer de points', () => {
    expect(applyTransition(TaskOccurrenceState.TODO, 'DETECT_MISSED')).toBe(
      TaskOccurrenceState.MISSED_PENDING_REVIEW,
    );
    // La detection n'a AUCUN effet sur le ledger : c'est la regle imperative.
    expect(ledgerEffectOf('DETECT_MISSED', { award: 20, penalty: 10 })).toBeNull();
  });

  it('laisse le parent confirmer ou ignorer une tache manquee', () => {
    expect(applyTransition(TaskOccurrenceState.MISSED_PENDING_REVIEW, 'CONFIRM_MISSED')).toBe(
      TaskOccurrenceState.MISSED_CONFIRMED,
    );
    expect(applyTransition(TaskOccurrenceState.MISSED_PENDING_REVIEW, 'IGNORE_MISSED')).toBe(
      TaskOccurrenceState.MISSED_IGNORED,
    );
  });

  it('refuse toute transition depuis un etat terminal', () => {
    for (const state of [
      TaskOccurrenceState.APPROVED,
      TaskOccurrenceState.MISSED_CONFIRMED,
      TaskOccurrenceState.MISSED_IGNORED,
    ]) {
      expect(canTransition(state, 'CLAIM_DONE')).toBe(false);
      expect(canTransition(state, 'APPROVE')).toBe(false);
      expect(() => applyTransition(state, 'APPROVE')).toThrow(DomainError);
    }
  });

  it("interdit de valider une tache qui n'a pas ete declaree terminee", () => {
    expect(canTransition(TaskOccurrenceState.TODO, 'APPROVE')).toBe(false);
    expect(canTransition(TaskOccurrenceState.MISSED_PENDING_REVIEW, 'APPROVE')).toBe(false);
  });

  it("n'ecrit au ledger que sur validation et confirmation d'absence", () => {
    const points = { award: 20, penalty: 10 };
    expect(ledgerEffectOf('APPROVE', points)).toBe(20);
    expect(ledgerEffectOf('CONFIRM_MISSED', points)).toBe(-10);
    expect(ledgerEffectOf('CLAIM_DONE', points)).toBeNull();
    expect(ledgerEffectOf('REJECT', points)).toBeNull();
    expect(ledgerEffectOf('IGNORE_MISSED', points)).toBeNull();
    // Le refus avec retrait est la seule autre ecriture possible.
    expect(ledgerEffectOf('REJECT_WITH_PENALTY', points)).toBe(-10);
  });

  it("n'ecrit rien quand la tache ne vaut aucun point", () => {
    expect(ledgerEffectOf('APPROVE', { award: 0, penalty: 10 })).toBeNull();
    expect(ledgerEffectOf('CONFIRM_MISSED', { award: 20, penalty: 0 })).toBeNull();
  });
});

describe('validation de la recurrence', () => {
  it('exige une echeance pour une tache ponctuelle', () => {
    expect(() => {
      assertRecurrenceIsValid(spec({ recurrence: TaskRecurrence.ONE_OFF, dueAt: null }));
    }).toThrow(DomainError);
  });

  it('exige une heure limite pour une tache recurrente', () => {
    expect(() => {
      assertRecurrenceIsValid(spec({ dueTime: null }));
    }).toThrow(DomainError);
  });

  it('exige au moins un jour pour une recurrence hebdomadaire', () => {
    expect(() => {
      assertRecurrenceIsValid(spec({ recurrence: TaskRecurrence.WEEKLY_DAYS, weekdays: [] }));
    }).toThrow(DomainError);
  });

  it('refuse un jour invalide ou duplique', () => {
    expect(() => {
      assertRecurrenceIsValid(spec({ recurrence: TaskRecurrence.WEEKLY_DAYS, weekdays: [0] }));
    }).toThrow(DomainError);
    expect(() => {
      assertRecurrenceIsValid(spec({ recurrence: TaskRecurrence.WEEKLY_DAYS, weekdays: [1, 1] }));
    }).toThrow(DomainError);
  });

  it("refuse une date de fin anterieure a la date d'effet", () => {
    expect(() => {
      assertRecurrenceIsValid(spec({ startDate: '2026-08-24', endDate: '2026-08-23' }));
    }).toThrow(DomainError);
  });
});

describe('planification des occurrences', () => {
  it('genere une occurrence par jour pour une tache quotidienne', () => {
    const planned = planOccurrences(spec(), '2026-08-24', '2026-08-27', PARIS);
    expect(planned.map((item) => item.occurrenceDate)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
    ]);
    expect(planned[0]!.dueAt.toISOString()).toBe('2026-08-24T17:00:00.000Z');
  });

  it('ne genere que les jours choisis pour une recurrence hebdomadaire', () => {
    const planned = planOccurrences(
      spec({ recurrence: TaskRecurrence.WEEKLY_DAYS, weekdays: [6, 7] }),
      '2026-08-24',
      '2026-08-31',
      PARIS,
    );
    // 2026-08-24 est un lundi ; samedi = 29, dimanche = 30.
    expect(planned.map((item) => item.occurrenceDate)).toEqual(['2026-08-29', '2026-08-30']);
  });

  it("ne genere rien avant la date d'effet ni apres la date de fin", () => {
    const planned = planOccurrences(
      spec({ startDate: '2026-08-26', endDate: '2026-08-27' }),
      '2026-08-24',
      '2026-08-31',
      PARIS,
    );
    expect(planned.map((item) => item.occurrenceDate)).toEqual(['2026-08-26', '2026-08-27']);
  });

  it("ne cree qu'une occurrence pour une tache ponctuelle", () => {
    const dueAt = new Date('2026-08-26T16:00:00Z');
    const planned = planOccurrences(
      spec({ recurrence: TaskRecurrence.ONE_OFF, startDate: '2026-08-26', dueAt }),
      '2026-08-24',
      '2026-08-31',
      PARIS,
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]!.dueAt).toEqual(dueAt);
  });

  it("recalcule l'echeance absolue autour d'un changement d'heure", () => {
    const planned = planOccurrences(
      spec({ startDate: '2026-10-24', dueTime: '19:00' }),
      '2026-10-24',
      '2026-10-26',
      PARIS,
    );
    // 25 octobre 2026 : retour a l'heure d'hiver. 19:00 locales change d'offset.
    expect(planned[0]!.dueAt.toISOString()).toBe('2026-10-24T17:00:00.000Z');
    expect(planned[2]!.dueAt.toISOString()).toBe('2026-10-26T18:00:00.000Z');
  });

  it('rend une liste vide si la fenetre est inversee', () => {
    expect(planOccurrences(spec(), '2026-08-27', '2026-08-24', PARIS)).toEqual([]);
  });

  it('reste deterministe : la meme fenetre produit toujours le meme plan', () => {
    const first = planOccurrences(spec(), '2026-08-24', '2026-08-27', PARIS);
    const second = planOccurrences(spec(), '2026-08-24', '2026-08-27', PARIS);
    expect(first).toEqual(second);
  });
});

describe('occursOn', () => {
  it('reconnait le jour de la semaine ISO', () => {
    const weekly = spec({ recurrence: TaskRecurrence.WEEKLY_DAYS, weekdays: [1] });
    expect(occursOn(weekly, '2026-08-24')).toBe(true); // lundi
    expect(occursOn(weekly, '2026-08-25')).toBe(false); // mardi
  });
});
