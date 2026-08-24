import { type NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { constantTimeEquals } from '@/server/crypto/random';
import { jsonError, jsonOk, withErrorHandling } from '@/server/http/respond';
import { runScheduledJobs } from '@/server/jobs/runner';

/**
 * Declencheur des jobs planifies.
 *
 * AUTHENTIFICATION — un jeton partage, jamais une session : l'ordonnanceur
 * n'est pas un utilisateur. Le jeton est accepte sous deux formes, parce que
 * les ordonnanceurs ne se ressemblent pas :
 *
 *   - `x-familipact-job-token: <jeton>`  — cron systeme, conteneur, appel manuel ;
 *   - `Authorization: Bearer <jeton>`    — Vercel Cron, qui envoie exactement
 *     cet en-tete lorsque la variable `CRON_SECRET` est definie sur le projet.
 *
 * La comparaison est faite a TEMPS CONSTANT : une comparaison naive
 * (`a === b`) s'arrete au premier caractere different et laisse mesurer le
 * jeton octet par octet.
 *
 * VERIFICATION D'ORIGINE — c'est la seule route de mutation qui n'en fait pas,
 * et c'est volontaire : le CSRF suppose un navigateur qui joint automatiquement
 * un cookie. Ici il n'y a ni cookie ni navigateur, et aucun ordonnanceur
 * n'envoie d'en-tete `Origin` : l'exiger casserait la route sans rien proteger.
 *
 * METHODES — GET et POST font la meme chose. GET est necessaire parce que
 * Vercel Cron n'emet que des GET. Utiliser un GET pour une operation qui ecrit
 * heurte les conventions HTTP, mais deux proprietes rendent la chose sure ici :
 * la route est inaccessible sans le jeton, et l'execution est idempotente par
 * creneau horaire — un rejeu, y compris par une prelecture de navigateur, ne
 * produit aucun effet supplementaire.
 */
const runIfAuthorised = (request: NextRequest) =>
  withErrorHandling(async () => {
    if (!isAuthorised(request)) {
      // Message volontairement laconique : la route ne confirme rien a qui ne
      // detient pas le jeton.
      return jsonError('FORBIDDEN', 'Jeton de tache invalide.', 403);
    }
    const results = await runScheduledJobs();
    return jsonOk({ results });
  });

const isAuthorised = (request: NextRequest): boolean => {
  const expected = getEnv().JOB_RUNNER_TOKEN;

  const custom = request.headers.get('x-familipact-job-token');
  if (custom !== null && constantTimeEquals(custom, expected)) return true;

  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const [scheme, ...rest] = authorization.split(' ');
    const token = rest.join(' ');
    if (scheme?.toLowerCase() === 'bearer' && constantTimeEquals(token, expected)) {
      return true;
    }
  }

  return false;
};

export const GET = runIfAuthorised;
export const POST = runIfAuthorised;

export const dynamic = 'force-dynamic';
