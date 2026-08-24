import { type NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { constantTimeEquals } from '@/server/crypto/random';
import { jsonError, jsonOk, withErrorHandling } from '@/server/http/respond';
import { runScheduledJobs } from '@/server/jobs/runner';

/**
 * Declencheur des jobs planifies.
 *
 * Protege par un jeton partage compare a temps constant, et jamais par une
 * session : l'ordonnanceur n'est pas un utilisateur.
 *
 * C'est la SEULE route de mutation sans verification d'origine, et c'est
 * volontaire : le CSRF suppose un navigateur qui joint automatiquement un
 * cookie. Ici il n'y a ni cookie ni navigateur, et un ordonnanceur n'envoie
 * pas d'en-tete `Origin` — l'exiger casserait la route sans rien protéger.
 *
 * L'execution est idempotente par creneau horaire : un declenchement en double
 * est sans effet.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    const provided = request.headers.get('x-familipact-job-token');
    if (provided === null || !constantTimeEquals(provided, getEnv().JOB_RUNNER_TOKEN)) {
      return jsonError('FORBIDDEN', 'Jeton de tache invalide.', 403);
    }
    const results = await runScheduledJobs();
    return jsonOk({ results });
  });

export const dynamic = 'force-dynamic';
