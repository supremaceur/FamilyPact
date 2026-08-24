import { describe, expect, it } from 'vitest';
import { PointTransactionSource, PointTransactionType } from '@/generated/prisma/enums';
import {
  MAX_TRANSACTION_DELTA,
  assertTransactionIsValid,
  buildReversal,
  computeBalance,
  previewBalance,
  type LedgerEntry,
  type ProposedTransaction,
} from './points';
import { DomainError } from './errors';

const entry = (overrides: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'tx-1',
  delta: 20,
  type: PointTransactionType.TASK_APPROVED,
  reversesTransactionId: null,
  ...overrides,
});

const transaction = (overrides: Partial<ProposedTransaction> = {}): ProposedTransaction => ({
  delta: 20,
  type: PointTransactionType.TASK_APPROVED,
  sourceType: PointTransactionSource.TASK_OCCURRENCE,
  sourceId: 'occurrence-1',
  label: 'Devoirs',
  reason: null,
  reversesTransactionId: null,
  ...overrides,
});

describe('computeBalance', () => {
  it('somme tous les mouvements, annulations comprises', () => {
    expect(
      computeBalance([
        entry({ id: 'a', delta: 100 }),
        entry({ id: 'b', delta: 20 }),
        entry({ id: 'c', delta: -10, type: PointTransactionType.TASK_MISSED }),
      ]),
    ).toBe(110);
  });

  it('rend zero pour un ledger vide', () => {
    expect(computeBalance([])).toBe(0);
  });

  it('laisse le score devenir negatif si les regles familiales le permettent', () => {
    // Choix produit explicite : le score n'est pas borne a zero.
    expect(computeBalance([entry({ delta: 10 }), entry({ id: 'b', delta: -30 })])).toBe(-20);
  });

  it("conserve l'erreur ET sa correction dans le calcul", () => {
    const erroneous = entry({ id: 'bad', delta: -20, type: PointTransactionType.TASK_MISSED });
    const correction = entry({
      id: 'fix',
      delta: 20,
      type: PointTransactionType.REVERSAL,
      reversesTransactionId: 'bad',
    });
    expect(computeBalance([entry({ id: 'start', delta: 100 }), erroneous, correction])).toBe(100);
  });
});

describe('assertTransactionIsValid', () => {
  it('accepte une transaction bien formee', () => {
    expect(() => {
      assertTransactionIsValid(transaction());
    }).not.toThrow();
  });

  it('refuse un mouvement nul', () => {
    expect(() => {
      assertTransactionIsValid(transaction({ delta: 0 }));
    }).toThrow(DomainError);
  });

  it('refuse un mouvement non entier', () => {
    expect(() => {
      assertTransactionIsValid(transaction({ delta: 1.5 }));
    }).toThrow(DomainError);
  });

  it('refuse un mouvement demesure', () => {
    expect(() => {
      assertTransactionIsValid(transaction({ delta: MAX_TRANSACTION_DELTA + 1 }));
    }).toThrow(DomainError);
  });

  it('exige un motif pour un ajustement manuel', () => {
    expect(() => {
      assertTransactionIsValid(
        transaction({
          type: PointTransactionType.MANUAL_ADJUSTMENT,
          sourceType: PointTransactionSource.MANUAL,
          sourceId: null,
          reason: null,
        }),
      );
    }).toThrow(/motif est obligatoire/i);

    expect(() => {
      assertTransactionIsValid(
        transaction({
          type: PointTransactionType.MANUAL_ADJUSTMENT,
          sourceType: PointTransactionSource.MANUAL,
          sourceId: null,
          reason: '   ',
        }),
      );
    }).toThrow(/motif est obligatoire/i);
  });

  it('exige que seule une annulation designe une transaction annulee', () => {
    expect(() => {
      assertTransactionIsValid(transaction({ reversesTransactionId: 'tx-9' }));
    }).toThrow(DomainError);

    expect(() => {
      assertTransactionIsValid(
        transaction({
          type: PointTransactionType.REVERSAL,
          sourceType: PointTransactionSource.REVERSAL,
          reason: 'Erreur de saisie',
          reversesTransactionId: null,
        }),
      );
    }).toThrow(DomainError);
  });
});

describe('buildReversal', () => {
  it("produit le mouvement inverse, sans jamais modifier l'original", () => {
    const original = { ...entry({ id: 'tx-42', delta: -20 }), label: 'Chambre non rangee' };
    const reversal = buildReversal(original, 'Lucas avait bien range');

    expect(reversal.delta).toBe(20);
    expect(reversal.type).toBe(PointTransactionType.REVERSAL);
    expect(reversal.reversesTransactionId).toBe('tx-42');
    expect(reversal.reason).toBe('Lucas avait bien range');
    expect(reversal.label).toContain('Chambre non rangee');
    // L'original est inchange : c'est l'invariant append-only.
    expect(original.delta).toBe(-20);
  });

  it("refuse d'annuler une annulation", () => {
    const reversal = {
      ...entry({ id: 'tx-r', delta: 20, type: PointTransactionType.REVERSAL }),
      label: 'Annulation',
    };
    expect(() => buildReversal(reversal, 'peu importe')).toThrow(DomainError);
  });
});

describe('previewBalance', () => {
  it('decrit la consequence affichee au parent avant confirmation', () => {
    expect(previewBalance(180, 20)).toEqual({ before: 180, delta: 20, after: 200 });
    expect(previewBalance(180, -10)).toEqual({ before: 180, delta: -10, after: 170 });
  });
});
