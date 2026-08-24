import 'server-only';

import { headers } from 'next/headers';
import { forbiddenError } from '@/domain/errors';
import { getEnv } from '@/lib/env';

/**
 * Protection CSRF.
 *
 * Le cookie de session est en `SameSite=Lax`, ce qui bloque deja l'envoi
 * automatique du cookie sur une requete POST inter-site. On ajoute une
 * verification d'ORIGINE cote serveur, car `SameSite` seul depend du navigateur
 * et laisse passer certains cas limites (anciens navigateurs, redirections).
 *
 * Toutes les mutations de l'API passent par `assertSameOrigin`.
 */
const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const assertSameOrigin = async (method: string): Promise<void> => {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return;

  const headerList = await headers();
  const origin = headerList.get('origin');
  const expected = getEnv().APP_ORIGIN;

  if (origin !== null) {
    if (origin !== expected) {
      throw forbiddenError('Origine de la requete non autorisee.');
    }
    return;
  }

  // Certains clients n'envoient pas `Origin` ; on retombe sur `Referer`.
  const referer = headerList.get('referer');
  if (referer !== null) {
    try {
      if (new URL(referer).origin === expected) return;
    } catch {
      // Referer illisible : traite comme absent.
    }
  }

  // `Sec-Fetch-Site: same-origin` est envoye par tous les navigateurs modernes.
  if (headerList.get('sec-fetch-site') === 'same-origin') return;

  throw forbiddenError("Impossible de verifier l'origine de la requete.");
};
