import 'server-only';

import { DomainError } from '@/domain/errors';
import type { Db } from '@/server/db/prisma';

/**
 * Rate limiting en fenetre fixe, stocke en base.
 *
 * Choix assume pour la V1 : pas de Redis. Une famille genere un trafic minuscule,
 * et un compteur en base reste correct avec plusieurs instances applicatives,
 * ce qu'un compteur en memoire ne serait pas. Le point d'extension est isole
 * dans ce seul module si un backend dedie devient necessaire.
 */

export interface RateLimitPolicy {
  /** Nombre de tentatives autorisees par fenetre. */
  readonly limit: number;
  /** Duree de la fenetre, en secondes. */
  readonly windowSeconds: number;
}

/**
 * Politiques appliquees. Les identifiants de connexion sont plus severement
 * limites que la navigation : c'est la surface d'attaque la plus exposee.
 */
export const RATE_LIMITS = {
  /** Connexion par mot de passe, par identifiant. */
  loginByIdentifier: { limit: 8, windowSeconds: 900 },
  /** Connexion par mot de passe, par adresse IP. */
  loginByIp: { limit: 40, windowSeconds: 900 },
  /** Verification d'un code TOTP. */
  totpVerification: { limit: 10, windowSeconds: 900 },
  /** Utilisation d'un code de recuperation. */
  recoveryCode: { limit: 5, windowSeconds: 3_600 },
  /** Tentative de consommation d'un jeton d'invitation, par IP. */
  invitationRedeem: { limit: 15, windowSeconds: 3_600 },
  /** Creation de compte parent, par IP. */
  registration: { limit: 5, windowSeconds: 3_600 },
  /** Ecritures metier authentifiees, par session. */
  mutation: { limit: 240, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export class RateLimitError extends DomainError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Trop de tentatives. Reessayez dans quelques minutes.');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const windowStart = (now: Date, windowSeconds: number): Date =>
  new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);

/**
 * Incremente le compteur et echoue si la limite est franchie.
 *
 * L'increment est atomique (`upsert` + `increment`), donc correct meme si
 * plusieurs requetes arrivent en parallele.
 */
export const consumeRateLimit = async (
  db: Db,
  name: RateLimitName,
  subject: string,
  now: Date = new Date(),
): Promise<void> => {
  const policy = RATE_LIMITS[name];
  const start = windowStart(now, policy.windowSeconds);
  const expiresAt = new Date(start.getTime() + policy.windowSeconds * 1000);
  const bucketKey = `${name}:${subject}`;

  const counter = await db.rateLimitCounter.upsert({
    where: { bucketKey_windowStartedAt: { bucketKey, windowStartedAt: start } },
    create: { bucketKey, windowStartedAt: start, count: 1, expiresAt },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  if (counter.count > policy.limit) {
    throw new RateLimitError(Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
  }
};

/** Remet un compteur a zero apres une authentification reussie. */
export const clearRateLimit = async (
  db: Db,
  name: RateLimitName,
  subject: string,
  now: Date = new Date(),
): Promise<void> => {
  const policy = RATE_LIMITS[name];
  await db.rateLimitCounter.deleteMany({
    where: {
      bucketKey: `${name}:${subject}`,
      windowStartedAt: windowStart(now, policy.windowSeconds),
    },
  });
};

/** Supprime les compteurs expires (appele par le job de maintenance). */
export const purgeExpiredRateLimits = async (db: Db, now: Date = new Date()): Promise<number> => {
  const result = await db.rateLimitCounter.deleteMany({ where: { expiresAt: { lt: now } } });
  return result.count;
};

// ---------------------------------------------------------------------------
// Verrouillage de compte
// ---------------------------------------------------------------------------

/**
 * Apres 10 echecs consecutifs, le compte est verrouille temporairement.
 * Le verrou est court : il ralentit une attaque par force brute sans offrir a
 * un tiers un moyen simple de bloquer durablement un compte legitime.
 */
export const MAX_FAILED_LOGINS = 10;
export const ACCOUNT_LOCK_SECONDS = 900;

export const isAccountLocked = (
  user: { readonly lockedUntil: Date | null },
  now: Date = new Date(),
): boolean => user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();

export const nextLockState = (
  failedLoginCount: number,
  now: Date = new Date(),
): { readonly failedLoginCount: number; readonly lockedUntil: Date | null } => {
  const next = failedLoginCount + 1;
  return {
    failedLoginCount: next,
    lockedUntil:
      next >= MAX_FAILED_LOGINS ? new Date(now.getTime() + ACCOUNT_LOCK_SECONDS * 1000) : null,
  };
};
