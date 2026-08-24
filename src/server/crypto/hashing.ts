import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import * as argon2 from '@node-rs/argon2';
import { getEnv } from '@/lib/env';

/**
 * Parametres Argon2id.
 *
 * 19 MiB / 2 iterations / 1 voie correspond a la configuration de reference
 * recommandee par l'OWASP pour Argon2id. Elle tient dans les limites memoire
 * d'un hebergement modeste tout en restant couteuse a paralleliser.
 */
/**
 * `@node-rs/argon2` expose `Algorithm` comme const enum ambiant : sa VALEUR est
 * inaccessible sous `verbatimModuleSyntax`, contrairement a son type. Argon2id
 * vaut 2 dans cette enumeration.
 */
const ARGON2ID: argon2.Algorithm = 2;

const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, ARGON2_OPTIONS);

export const verifyPassword = async (hash: string, password: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Un hash corrompu ne doit pas laisser fuiter d'information.
    return false;
  }
};

/**
 * Hash factice verifie lorsqu'aucun compte ne correspond a l'identifiant.
 *
 * Sans cela, une reponse instantanee revelerait qu'un email n'existe pas
 * (enumeration de comptes).
 */
let dummyHashPromise: Promise<string> | null = null;

export const consumeDummyPasswordWork = async (): Promise<void> => {
  dummyHashPromise ??= argon2.hash('familipact-dummy-password', ARGON2_OPTIONS);
  const hash = await dummyHashPromise;
  await argon2.verify(hash, 'familipact-dummy-password-mismatch').catch(() => false);
};

/** Hash Argon2id d'un code de recuperation (secret court, mais a fort entropie). */
export const hashRecoveryCode = (code: string): Promise<string> =>
  argon2.hash(code, ARGON2_OPTIONS);

export const verifyRecoveryCode = async (hash: string, code: string): Promise<boolean> => {
  try {
    return await argon2.verify(hash, code);
  } catch {
    return false;
  }
};

/**
 * Hash deterministe pour les valeurs a fort entropie qui doivent rester
 * INDEXABLES : jetons de session, jetons d'invitation.
 *
 * SHA-256 suffit ici parce que la valeur d'origine fait au moins 128 bits
 * aleatoires : il n'y a rien a « deviner » par force brute. Un hash lent
 * serait inutilisable pour une recherche par index.
 */
export const hashLookupToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * Pseudonymise une donnee de journalisation (IP, user-agent) avec un HMAC.
 *
 * On conserve la capacite de correler deux evenements sans jamais stocker la
 * donnee personnelle elle-meme (voir docs/privacy.md).
 */
export const pseudonymize = (value: string): string =>
  createHmac('sha256', Buffer.from(getEnv().LOG_PEPPER_KEY, 'base64'))
    .update(value, 'utf8')
    .digest('base64url')
    .slice(0, 32);
