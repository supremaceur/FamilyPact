/**
 * Execution manuelle des jobs planifies.
 *
 * Utile en developpement et comme point d'entree pour un ordonnanceur externe
 * (cron systeme, tache planifiee de l'hebergeur) qui prefererait lancer un
 * processus plutot que d'appeler `POST /api/jobs/run`.
 *
 * L'execution est idempotente par creneau horaire : lancer ce script deux fois
 * dans la meme heure ne produit aucun effet supplementaire.
 */
import 'dotenv/config';
import { runScheduledJobs } from '../src/server/jobs/runner';
import { prisma } from '../src/server/db/prisma';

const main = async (): Promise<void> => {
  const results = await runScheduledJobs();
  for (const result of results) {
    const detail =
      result.status === 'FAILED'
        ? ` — ${result.error ?? 'erreur inconnue'}`
        : ` — ${result.itemsProcessed} element(s)`;
    console.log(`${result.job.padEnd(22)} ${result.status}${detail}`);
  }
  if (results.some((result) => result.status === 'FAILED')) process.exitCode = 1;
};

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
