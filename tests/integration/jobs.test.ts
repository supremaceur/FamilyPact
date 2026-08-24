import { toLocalDate } from '@/domain/time';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TaskOccurrenceState, TaskRecurrence } from '@/generated/prisma/enums';
import { prisma } from '@/server/db/prisma';
import { hourlyRunKey, runGenerateOccurrences, runScheduledJobs } from '@/server/jobs/runner';
import { createTaskDefinition } from '@/server/services/task-definitions';
import { addChild, createFamily } from './helpers';
import type { FamilyActor } from '@/server/auth/context';

/**
 * Jobs planifies : idempotence par creneau, generation d'occurrences,
 * detection des echeances sans effet sur le ledger.
 */

let family: Awaited<ReturnType<typeof createFamily>>;
let child: Awaited<ReturnType<typeof addChild>>;
let owner: FamilyActor;

beforeEach(async () => {
  await prisma.jobRun.deleteMany({});
  family = await createFamily();
  owner = family.ownerActor;
  child = await addChild(family.familyId, { displayName: 'Lucas' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('idempotence des jobs', () => {
  it('refuse de rejouer un creneau deja traite', async () => {
    const first = await runScheduledJobs();
    expect(first.every((result) => result.status === 'EXECUTED')).toBe(true);

    const second = await runScheduledJobs();
    expect(second.every((result) => result.status === 'SKIPPED_ALREADY_RUN')).toBe(true);
  });

  it('utilise un creneau distinct par heure', () => {
    expect(hourlyRunKey(new Date('2026-08-24T13:05:00Z'))).toBe('2026-08-24T13');
    expect(hourlyRunKey(new Date('2026-08-24T13:59:59Z'))).toBe('2026-08-24T13');
    expect(hourlyRunKey(new Date('2026-08-24T14:00:00Z'))).toBe('2026-08-24T14');
  });

  it("ne cree qu'une execution meme sous declenchements simultanes", async () => {
    await Promise.allSettled([runScheduledJobs(), runScheduledJobs(), runScheduledJobs()]);

    const runs = await prisma.jobRun.groupBy({
      by: ['jobName'],
      _count: { _all: true },
    });
    for (const run of runs) {
      expect(run._count._all).toBe(1);
    }
  });
});

describe('generation des occurrences', () => {
  it('materialise les occurrences a venir sans creer de doublon', async () => {
    const today = toLocalDate(new Date(), family.timeZone);
    await createTaskDefinition(owner, {
      childMembershipId: child.membershipId,
      title: 'Devoirs',
      description: null,
      pointsAward: 20,
      pointsPenalty: 10,
      recurrence: TaskRecurrence.DAILY,
      startDate: today,
      endDate: null,
      dueTime: '18:30',
      weekdays: [],
    });

    const afterCreation = await prisma.taskOccurrence.count({
      where: { familyId: family.familyId },
    });
    expect(afterCreation).toBeGreaterThan(0);

    // Le job rejoue la meme fenetre : la contrainte unique absorbe les doublons.
    const created = await runGenerateOccurrences(prisma, new Date());
    expect(created).toBe(0);
    expect(await prisma.taskOccurrence.count({ where: { familyId: family.familyId } })).toBe(
      afterCreation,
    );
  });

  it('respecte le fuseau horaire de chaque famille', async () => {
    const remote = await createFamily({ name: 'Famille lointaine', timeZone: 'Pacific/Auckland' });
    const remoteChild = await addChild(remote.familyId, { displayName: 'Kiri' });
    const today = toLocalDate(new Date(), family.timeZone);

    await createTaskDefinition(remote.ownerActor, {
      childMembershipId: remoteChild.membershipId,
      title: 'Devoirs',
      description: null,
      pointsAward: 20,
      pointsPenalty: 0,
      recurrence: TaskRecurrence.DAILY,
      startDate: today,
      endDate: null,
      dueTime: '18:30',
      weekdays: [],
    });

    const occurrence = await prisma.taskOccurrence.findFirstOrThrow({
      where: { familyId: remote.familyId },
      orderBy: { occurrenceDate: 'asc' },
      select: { occurrenceDate: true, dueAt: true },
    });

    // 18h30 a Auckland, exprimee en UTC, n'est pas 18h30 UTC.
    const utcHour = occurrence.dueAt.getUTCHours();
    expect(utcHour).not.toBe(18);
    expect(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Pacific/Auckland',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(occurrence.dueAt),
    ).toBe('18:30');
  });
});

describe('detection des echeances par le job complet', () => {
  it('signale sans jamais retirer de points', async () => {
    const today = toLocalDate(new Date(), family.timeZone);
    await createTaskDefinition(owner, {
      childMembershipId: child.membershipId,
      title: 'Ranger la chambre',
      description: null,
      pointsAward: 10,
      pointsPenalty: 15,
      recurrence: TaskRecurrence.ONE_OFF,
      startDate: today,
      endDate: null,
      dueTime: '23:59',
      weekdays: [],
    });

    // On repousse l'echeance dans le passe pour simuler le temps ecoule.
    await prisma.taskOccurrence.updateMany({
      where: { familyId: family.familyId },
      data: { dueAt: new Date(Date.now() - 3_600_000) },
    });

    await runScheduledJobs();

    const occurrence = await prisma.taskOccurrence.findFirstOrThrow({
      where: { familyId: family.familyId },
      select: { state: true },
    });
    expect(occurrence.state).toBe(TaskOccurrenceState.MISSED_PENDING_REVIEW);

    // Le job n'ecrit RIEN au ledger : c'est la regle imperative du produit.
    expect(await prisma.pointTransaction.count({ where: { familyId: family.familyId } })).toBe(0);
  });
});
