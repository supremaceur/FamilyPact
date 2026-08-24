import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FamilyRole,
  ParentPermission,
  PointTransactionSource,
  PointTransactionType,
  TaskOccurrenceState,
  TaskRecurrence,
} from '@/generated/prisma/enums';
import { DomainError } from '@/domain/errors';
import { prisma } from '@/server/db/prisma';
import { createTaskDefinition } from '@/server/services/task-definitions';
import {
  approveOccurrence,
  claimOccurrenceDone,
  confirmMissedOccurrence,
  detectMissedOccurrences,
  ignoreMissedOccurrence,
  rejectOccurrence,
} from '@/server/services/task-occurrences';
import { adjustPoints, reversePointTransaction } from '@/server/services/point-adjustments';
import { addChild, addParent, cachedBalance, createFamily, ledgerBalance } from './helpers';
import type { FamilyActor } from '@/server/auth/context';

/**
 * Cas metier A a D : credit, double validation concurrente, absence de retrait
 * automatique, et decision d'ignorer.
 */

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

let family: Awaited<ReturnType<typeof createFamily>>;
let child: Awaited<ReturnType<typeof addChild>>;
let owner: FamilyActor;

beforeEach(async () => {
  family = await createFamily();
  owner = family.ownerActor;
  child = await addChild(family.familyId, { displayName: 'Lucas' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Cree une tache du jour dont l'echeance sera consideree comme depassee.
 *
 * Le temps n'est pas simule en manipulant l'horloge ni la base : on avance
 * simplement le `now` fourni au detecteur. Les occurrences ne sont jamais
 * generees retroactivement, une tache datee d'hier ne produirait donc aucune
 * occurrence — ce comportement est lui-meme un invariant du produit.
 */
const createTaskWithPastDeadline = async (points: { award: number; penalty: number }) => {
  const { id } = await createTaskDefinition(owner, {
    childMembershipId: child.membershipId,
    title: 'Ranger la chambre',
    description: null,
    pointsAward: points.award,
    pointsPenalty: points.penalty,
    recurrence: TaskRecurrence.ONE_OFF,
    startDate: toIsoDate(new Date()),
    endDate: null,
    dueTime: '08:00',
    weekdays: [],
  });
  return id;
};

/** Instant situe apres toutes les echeances du jour. */
const AFTER_TODAY = new Date(Date.now() + 2 * 86_400_000);

const createTodayTask = async (points: { award: number; penalty: number }, title = 'Devoirs') => {
  const today = new Date();
  const { id } = await createTaskDefinition(owner, {
    childMembershipId: child.membershipId,
    title,
    description: null,
    pointsAward: points.award,
    pointsPenalty: points.penalty,
    recurrence: TaskRecurrence.ONE_OFF,
    startDate: toIsoDate(today),
    endDate: null,
    dueTime: '23:59',
    weekdays: [],
  });
  const occurrence = await prisma.taskOccurrence.findFirstOrThrow({
    where: { taskDefinitionId: id },
    select: { id: true },
  });
  return occurrence.id;
};

const seedBalance = async (amount: number): Promise<void> => {
  await adjustPoints(owner, {
    childMembershipId: child.membershipId,
    delta: amount,
    reason: 'Solde initial du scenario de test',
    idempotencyKey: null,
  });
};

describe('Cas A — une tache validee credite exactement une fois', () => {
  it('porte le score de 100 a 120 et laisse une seule transaction', async () => {
    await seedBalance(100);
    const occurrenceId = await createTodayTask({ award: 20, penalty: 10 });

    await claimOccurrenceDone(child.actor, occurrenceId);
    const result = await approveOccurrence(owner, occurrenceId);

    expect(result.state).toBe(TaskOccurrenceState.APPROVED);
    expect(result.balanceBefore).toBe(100);
    expect(result.balanceAfter).toBe(120);
    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(120);
    expect(await cachedBalance(child.membershipId)).toBe(120);

    const transactions = await prisma.pointTransaction.findMany({
      where: { sourceId: occurrenceId, type: PointTransactionType.TASK_APPROVED },
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]!.delta).toBe(20);
    expect(transactions[0]!.approvedById).toBe(owner.membershipId);
  });
});

describe('Cas B — deux parents validant simultanement', () => {
  it("ne credite les points qu'une seule fois", async () => {
    await seedBalance(100);
    const occurrenceId = await createTodayTask({ award: 20, penalty: 10 });
    await claimOccurrenceDone(child.actor, occurrenceId);

    const secondParent = await addParent(family.familyId, {
      role: FamilyRole.ADMIN,
      displayName: 'Paul',
    });

    // Les deux validations partent reellement en parallele.
    const [first, second] = await Promise.allSettled([
      approveOccurrence(owner, occurrenceId),
      approveOccurrence(secondParent, occurrenceId),
    ]);

    // Aucune des deux ne doit lever d'erreur : la seconde constate simplement
    // que la decision est deja prise.
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('fulfilled');

    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(120);
    expect(await cachedBalance(child.membershipId)).toBe(120);

    const transactions = await prisma.pointTransaction.findMany({
      where: { sourceId: occurrenceId, type: PointTransactionType.TASK_APPROVED },
    });
    expect(transactions).toHaveLength(1);
  });

  it('resiste a quatre validations simultanees', async () => {
    const occurrenceId = await createTodayTask({ award: 15, penalty: 0 });
    await claimOccurrenceDone(child.actor, occurrenceId);

    const parents = await Promise.all([
      addParent(family.familyId, { role: FamilyRole.ADMIN }),
      addParent(family.familyId, { role: FamilyRole.ADMIN }),
      addParent(family.familyId, { role: FamilyRole.ADMIN }),
    ]);

    await Promise.allSettled([
      approveOccurrence(owner, occurrenceId),
      ...parents.map((parent) => approveOccurrence(parent, occurrenceId)),
    ]);

    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(15);
    expect(
      await prisma.pointTransaction.count({
        where: { sourceId: occurrenceId, type: PointTransactionType.TASK_APPROVED },
      }),
    ).toBe(1);
  });
});

describe('Cas C — echeance depassee puis confirmation parentale', () => {
  it('ne retire rien automatiquement, puis retire apres confirmation', async () => {
    await seedBalance(100);
    await createTaskWithPastDeadline({ award: 20, penalty: 10 });

    const detected = await detectMissedOccurrences(prisma, {
      familyId: family.familyId,
      now: AFTER_TODAY,
    });
    expect(detected).toBe(1);

    const occurrence = await prisma.taskOccurrence.findFirstOrThrow({
      where: { familyId: family.familyId },
      select: { id: true, state: true },
    });
    expect(occurrence.state).toBe(TaskOccurrenceState.MISSED_PENDING_REVIEW);

    // Regle imperative : la detection n'ecrit RIEN au ledger.
    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(100);
    expect(
      await prisma.pointTransaction.count({
        where: { familyId: family.familyId, type: PointTransactionType.TASK_MISSED },
      }),
    ).toBe(0);

    const result = await confirmMissedOccurrence(owner, occurrence.id);
    expect(result.state).toBe(TaskOccurrenceState.MISSED_CONFIRMED);
    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(90);

    const penalty = await prisma.pointTransaction.findFirstOrThrow({
      where: { sourceId: occurrence.id, type: PointTransactionType.TASK_MISSED },
    });
    expect(penalty.delta).toBe(-10);
    expect(penalty.approvedById).toBe(owner.membershipId);
  });
});

describe("Cas D — echeance depassee puis decision d'ignorer", () => {
  it('ne cree aucune transaction', async () => {
    await seedBalance(100);
    await createTaskWithPastDeadline({ award: 20, penalty: 10 });
    await detectMissedOccurrences(prisma, { familyId: family.familyId, now: AFTER_TODAY });

    const occurrence = await prisma.taskOccurrence.findFirstOrThrow({
      where: { familyId: family.familyId },
      select: { id: true },
    });

    const result = await ignoreMissedOccurrence(owner, occurrence.id);
    expect(result.state).toBe(TaskOccurrenceState.MISSED_IGNORED);
    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(100);
    expect(
      await prisma.pointTransaction.count({
        where: { familyId: family.familyId, type: PointTransactionType.TASK_MISSED },
      }),
    ).toBe(0);
  });
});

describe('refus et nouvelle declaration', () => {
  it('ne credite rien au refus et laisse la tache re-declarable', async () => {
    await seedBalance(50);
    const occurrenceId = await createTodayTask({ award: 20, penalty: 0 });
    await claimOccurrenceDone(child.actor, occurrenceId);

    await rejectOccurrence(owner, occurrenceId, 'La chambre est encore en desordre');
    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(50);

    // L'enfant peut re-declarer, puis obtenir la validation.
    await claimOccurrenceDone(child.actor, occurrenceId);
    await approveOccurrence(owner, occurrenceId);
    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(70);
  });
});

describe('detection idempotente des echeances', () => {
  it('rejouer le job ne cree pas de seconde demande', async () => {
    await createTaskWithPastDeadline({ award: 20, penalty: 10 });

    expect(
      await detectMissedOccurrences(prisma, { familyId: family.familyId, now: AFTER_TODAY }),
    ).toBe(1);
    expect(
      await detectMissedOccurrences(prisma, { familyId: family.familyId, now: AFTER_TODAY }),
    ).toBe(0);

    const notifications = await prisma.notification.count({
      where: { familyId: family.familyId, kind: 'TASK_MISSED_PENDING' },
    });
    // Une seule notification par parent habilite, meme apres rejeu.
    expect(notifications).toBe(1);
  });
});

describe('permissions sur les decisions', () => {
  it('refuse a un parent sans permission de valider une tache', async () => {
    const occurrenceId = await createTodayTask({ award: 20, penalty: 0 });
    await claimOccurrenceDone(child.actor, occurrenceId);

    const limitedParent = await addParent(family.familyId, {
      role: FamilyRole.PARENT,
      permissions: [ParentPermission.TASK_CONFIRM_MISSED],
    });

    await expect(approveOccurrence(limitedParent, occurrenceId)).rejects.toThrow(DomainError);
    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(0);
  });

  it('refuse a un enfant de valider sa propre tache', async () => {
    const occurrenceId = await createTodayTask({ award: 20, penalty: 0 });
    await claimOccurrenceDone(child.actor, occurrenceId);

    await expect(approveOccurrence(child.actor, occurrenceId)).rejects.toThrow(DomainError);
    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(0);
  });

  it("refuse a un enfant de declarer la tache d'un autre enfant", async () => {
    const sibling = await addChild(family.familyId, { displayName: 'Emma' });
    const occurrenceId = await createTodayTask({ award: 20, penalty: 0 });

    await expect(claimOccurrenceDone(sibling.actor, occurrenceId)).rejects.toThrow(DomainError);
  });
});

describe('corrections manuelles', () => {
  it('exige un motif et enregistre une transaction distincte', async () => {
    await seedBalance(100);

    await expect(
      adjustPoints(owner, {
        childMembershipId: child.membershipId,
        delta: 10,
        reason: '',
        idempotencyKey: null,
      }),
    ).rejects.toThrow();

    const result = await adjustPoints(owner, {
      childMembershipId: child.membershipId,
      delta: -15,
      reason: 'Vitre cassee dans le salon',
      idempotencyKey: null,
    });
    expect(result.balanceAfter).toBe(85);
  });

  it('annule une transaction sans jamais la modifier', async () => {
    await seedBalance(100);
    const occurrenceId = await createTodayTask({ award: 20, penalty: 0 });
    await claimOccurrenceDone(child.actor, occurrenceId);
    await approveOccurrence(owner, occurrenceId);

    const original = await prisma.pointTransaction.findFirstOrThrow({
      where: { sourceId: occurrenceId, type: PointTransactionType.TASK_APPROVED },
      select: { id: true, delta: true, createdAt: true },
    });

    const reversal = await reversePointTransaction(owner, {
      transactionId: original.id,
      reason: "Validee par erreur, la tache n'etait pas faite",
    });
    expect(reversal.balanceAfter).toBe(100);

    // L'originale est intacte : meme identifiant, meme delta, meme horodatage.
    const stillThere = await prisma.pointTransaction.findUniqueOrThrow({
      where: { id: original.id },
      select: { delta: true, createdAt: true },
    });
    expect(stillThere.delta).toBe(original.delta);
    expect(stillThere.createdAt).toEqual(original.createdAt);

    // Les deux lignes coexistent dans l'historique.
    const all = await prisma.pointTransaction.findMany({
      where: { familyId: family.familyId, childMembershipId: child.membershipId },
      orderBy: { createdAt: 'asc' },
      select: { delta: true, type: true, reversesTransactionId: true },
    });
    expect(all.map((row) => row.delta)).toEqual([100, 20, -20]);
    expect(all[2]!.reversesTransactionId).toBe(original.id);
  });

  it('refuse une seconde annulation de la meme transaction', async () => {
    await seedBalance(100);
    const original = await prisma.pointTransaction.findFirstOrThrow({
      where: { familyId: family.familyId },
      select: { id: true },
    });

    await reversePointTransaction(owner, {
      transactionId: original.id,
      reason: 'Premiere correction',
    });
    await expect(
      reversePointTransaction(owner, {
        transactionId: original.id,
        reason: 'Seconde tentative',
      }),
    ).rejects.toThrow(DomainError);
  });

  it("neutralise un double envoi grace a la cle d'idempotence", async () => {
    const key = 'test-idempotency-key-000001';
    await adjustPoints(owner, {
      childMembershipId: child.membershipId,
      delta: 25,
      reason: 'Aide au menage',
      idempotencyKey: key,
    });
    // Le meme envoi rejoue ne doit pas crediter une seconde fois.
    await expect(
      adjustPoints(owner, {
        childMembershipId: child.membershipId,
        delta: 25,
        reason: 'Aide au menage',
        idempotencyKey: key,
      }),
    ).rejects.toThrow();

    expect(await ledgerBalance(family.familyId, child.membershipId)).toBe(25);
  });
});

describe('immuabilite du ledger au niveau de la base', () => {
  it("rejette toute modification directe d'une transaction", async () => {
    await seedBalance(100);
    const transaction = await prisma.pointTransaction.findFirstOrThrow({
      where: { familyId: family.familyId },
      select: { id: true },
    });

    await expect(
      prisma.pointTransaction.update({
        where: { id: transaction.id },
        data: { delta: 9_999 },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.pointTransaction.delete({ where: { id: transaction.id } }),
    ).rejects.toThrow();
  });

  it('rejette une transaction de zero point', async () => {
    await expect(
      prisma.pointTransaction.create({
        data: {
          familyId: family.familyId,
          childMembershipId: child.membershipId,
          delta: 0,
          type: PointTransactionType.MANUAL_ADJUSTMENT,
          sourceType: PointTransactionSource.MANUAL,
          label: 'Test',
          reason: 'Test',
        },
      }),
    ).rejects.toThrow();
  });
});
