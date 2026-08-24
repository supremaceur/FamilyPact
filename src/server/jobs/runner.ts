import 'server-only';

import { JobRunStatus } from '@/generated/prisma/enums';
import { Prisma } from '@/generated/prisma/client';
import { prisma, type Db } from '@/server/db/prisma';
import { purgeExpiredRateLimits } from '@/server/auth/rate-limit';
import { purgeExpiredChallenges } from '@/server/auth/webauthn';
import {
  detectMissedOccurrences,
  generateOccurrencesForDefinition,
} from '@/server/services/task-occurrences';
import { evaluateChildRules } from '@/server/services/rules-engine';

/**
 * Jobs planifies.
 *
 * IDEMPOTENCE — chaque execution est associee a une CLE DE CRENEAU (`runKey`).
 * La contrainte unique `(jobName, runKey)` fait qu'une seconde execution sur le
 * meme creneau est refusee et se termine sans effet. Un ordonnanceur qui
 * declenche deux fois le meme creneau ne produit donc jamais deux penalites ni
 * deux propositions.
 *
 * Au-dela de ce verrou, chaque job est ecrit pour etre naturellement
 * reexecutable : mises a jour conditionnees a l'etat attendu, `skipDuplicates`
 * a la generation, cles de deduplication sur les notifications.
 *
 * Aucun de ces jobs ne prend de decision a la place d'un parent. Le job
 * d'echeance cree des demandes de decision ; le job d'evaluation cree des
 * propositions. Rien de plus.
 */

export type JobName = 'generate-occurrences' | 'detect-missed' | 'evaluate-rules' | 'purge-expired';

export interface JobResult {
  readonly job: JobName;
  readonly status: 'EXECUTED' | 'SKIPPED_ALREADY_RUN' | 'FAILED';
  readonly itemsProcessed: number;
  readonly error?: string;
}

/** Creneau horaire : un job ne s'execute qu'une fois par heure entamee. */
export const hourlyRunKey = (now: Date): string => now.toISOString().slice(0, 13);

const UNIQUE_VIOLATION = 'P2002';

/**
 * Enveloppe un job dans son verrou d'idempotence.
 *
 * Le verrou est pose AVANT l'execution : si le processus meurt en cours de
 * route, le creneau est marque FAILED et pourra etre relance manuellement,
 * plutot que rejoue silencieusement.
 */
const withJobLock = async (
  job: JobName,
  runKey: string,
  execute: () => Promise<number>,
): Promise<JobResult> => {
  let runId: string;
  try {
    const run = await prisma.jobRun.create({
      data: { jobName: job, runKey, status: JobRunStatus.RUNNING },
      select: { id: true },
    });
    runId = run.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION) {
      return { job, status: 'SKIPPED_ALREADY_RUN', itemsProcessed: 0 };
    }
    throw error;
  }

  try {
    const itemsProcessed = await execute();
    await prisma.jobRun.update({
      where: { id: runId },
      data: { status: JobRunStatus.SUCCEEDED, finishedAt: new Date(), itemsProcessed },
    });
    return { job, status: 'EXECUTED', itemsProcessed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    await prisma.jobRun.update({
      where: { id: runId },
      data: { status: JobRunStatus.FAILED, finishedAt: new Date(), error: message.slice(0, 1_000) },
    });
    return { job, status: 'FAILED', itemsProcessed: 0, error: message };
  }
};

/**
 * Materialise les occurrences a venir de toutes les taches recurrentes actives.
 * Chaque famille est traitee dans son propre fuseau horaire.
 */
export const runGenerateOccurrences = async (db: Db, now: Date): Promise<number> => {
  const families = await db.family.findMany({ select: { id: true, timeZone: true } });
  let created = 0;

  for (const family of families) {
    const definitions = await db.taskDefinition.findMany({
      where: { familyId: family.id, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const definition of definitions) {
      created += await generateOccurrencesForDefinition(db, {
        familyId: family.id,
        taskDefinitionId: definition.id,
        timeZone: family.timeZone,
        now,
      });
    }
  }
  return created;
};

/**
 * Reevalue les regles de chaque enfant.
 *
 * Necessaire meme sans variation de score : les conditions de levee a base de
 * DATE ne dependent que du temps qui passe.
 */
export const runEvaluateRules = async (db: Db, now: Date): Promise<number> => {
  const children = await db.familyMembership.findMany({
    where: { role: 'CHILD', status: 'ACTIVE' },
    select: {
      id: true,
      familyId: true,
      user: { select: { displayName: true } },
      childProfile: { select: { cachedBalance: true } },
    },
  });

  let evaluated = 0;
  for (const child of children) {
    if (child.childProfile === null) continue;
    await evaluateChildRules(db, {
      familyId: child.familyId,
      childMembershipId: child.id,
      childName: child.user.displayName,
      score: child.childProfile.cachedBalance,
      now,
    });
    evaluated += 1;
  }
  return evaluated;
};

/** Nettoyage des donnees techniques expirees. */
export const runPurgeExpired = async (db: Db, now: Date): Promise<number> => {
  const [rateLimits, challenges, sessions] = await Promise.all([
    purgeExpiredRateLimits(db, now),
    purgeExpiredChallenges(db, now),
    db.session.deleteMany({
      where: {
        OR: [
          { absoluteExpiresAt: { lt: now } },
          { revokedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } },
        ],
      },
    }),
  ]);
  return rateLimits + challenges + sessions.count;
};

/**
 * Execute la sequence complete. L'ordre importe :
 *   1. generer les occurrences a venir ;
 *   2. detecter les echeances depassees (aucun point retire) ;
 *   3. reevaluer les regles (paliers et conditions de levee) ;
 *   4. nettoyer les donnees techniques expirees.
 */
export const runScheduledJobs = async (now: Date = new Date()): Promise<readonly JobResult[]> => {
  const runKey = hourlyRunKey(now);
  return [
    await withJobLock('generate-occurrences', runKey, () => runGenerateOccurrences(prisma, now)),
    await withJobLock('detect-missed', runKey, () => detectMissedOccurrences(prisma, { now })),
    await withJobLock('evaluate-rules', runKey, () => runEvaluateRules(prisma, now)),
    await withJobLock('purge-expired', runKey, () => runPurgeExpired(prisma, now)),
  ];
};
