import 'server-only';

import { cookies } from 'next/headers';
import { SessionStatus, type UserKind } from '@/generated/prisma/enums';
import { DomainError } from '@/domain/errors';
import { getEnv } from '@/lib/env';
import type { Db } from '@/server/db/prisma';
import { hashLookupToken, pseudonymize } from '@/server/crypto/hashing';
import { generateOpaqueToken } from '@/server/crypto/random';

/**
 * Sessions serveur, opaques et revocables.
 *
 * Un JWT auto-porteur serait plus simple, mais impossible a revoquer
 * immediatement : or FamiliPact doit pouvoir couper l'acces d'un parent retire
 * de la famille a la seconde ou la decision est prise. Le cookie ne transporte
 * donc qu'un jeton aleatoire, dont seul le SHA-256 est stocke.
 */

export const SESSION_COOKIE_NAME = '__Host-familipact_session';

/** Expiration glissante : toute activite repousse l'echeance. */
export const SESSION_IDLE_SECONDS = 60 * 60 * 12;
/** Expiration absolue : une session ne survit jamais au-dela, meme active. */
export const SESSION_ABSOLUTE_SECONDS = 60 * 60 * 24 * 30;
/** Duree d'une re-authentification forte, pour les operations sensibles. */
export const STEP_UP_SECONDS = 60 * 10;

export interface SessionRequestContext {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface IssuedSession {
  readonly sessionId: string;
  /** Jeton brut, a poser dans le cookie et jamais journalise. */
  readonly token: string;
  readonly status: SessionStatus;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

const digestUserAgent = (userAgent: string | null): string | null =>
  userAgent === null ? null : pseudonymize(userAgent.slice(0, 512));

const digestIp = (ip: string | null): string | null => (ip === null ? null : pseudonymize(ip));

export const createSession = async (
  db: Db,
  params: {
    readonly userId: string;
    readonly status: SessionStatus;
    readonly authMethods: readonly string[];
    readonly request: SessionRequestContext;
    readonly elevated?: boolean;
    readonly now?: Date;
  },
): Promise<IssuedSession> => {
  const now = params.now ?? new Date();
  const token = generateOpaqueToken(32);

  const session = await db.session.create({
    data: {
      userId: params.userId,
      tokenHash: hashLookupToken(token),
      status: params.status,
      authMethods: [...params.authMethods],
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_SECONDS * 1000),
      absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_SECONDS * 1000),
      elevatedUntil:
        params.elevated === true ? new Date(now.getTime() + STEP_UP_SECONDS * 1000) : null,
      ipHash: digestIp(params.request.ip),
      userAgentDigest: digestUserAgent(params.request.userAgent),
    },
    select: { id: true, status: true, idleExpiresAt: true, absoluteExpiresAt: true },
  });

  return {
    sessionId: session.id,
    token,
    status: session.status,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
  };
};

export interface LoadedSession {
  readonly id: string;
  readonly status: SessionStatus;
  readonly authMethods: readonly string[];
  readonly elevatedUntil: Date | null;
  readonly user: {
    readonly id: string;
    readonly kind: UserKind;
    readonly displayName: string;
    readonly email: string | null;
    readonly loginId: string | null;
    readonly locale: string;
    readonly hasConfirmedTotp: boolean;
  };
}

/**
 * Charge la session designee par un jeton, en verifiant les deux expirations et
 * la revocation. Prolonge l'expiration glissante au passage.
 */
export const loadSessionByToken = async (
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<LoadedSession | null> => {
  const session = await db.session.findUnique({
    where: { tokenHash: hashLookupToken(token) },
    select: {
      id: true,
      status: true,
      authMethods: true,
      elevatedUntil: true,
      revokedAt: true,
      idleExpiresAt: true,
      absoluteExpiresAt: true,
      user: {
        select: {
          id: true,
          kind: true,
          status: true,
          displayName: true,
          email: true,
          loginId: true,
          locale: true,
          totpCredential: { select: { confirmedAt: true } },
        },
      },
    },
  });

  if (session === null) return null;
  if (session.revokedAt !== null) return null;
  if (session.idleExpiresAt.getTime() <= now.getTime()) return null;
  if (session.absoluteExpiresAt.getTime() <= now.getTime()) return null;
  if (session.user.status !== 'ACTIVE') return null;

  // Prolongation de la fenetre d'inactivite, plafonnee par l'expiration absolue.
  const nextIdleExpiry = new Date(
    Math.min(now.getTime() + SESSION_IDLE_SECONDS * 1000, session.absoluteExpiresAt.getTime()),
  );
  await db.session.update({
    where: { id: session.id },
    data: { lastSeenAt: now, idleExpiresAt: nextIdleExpiry },
  });

  return {
    id: session.id,
    status: session.status,
    authMethods: session.authMethods,
    elevatedUntil: session.elevatedUntil,
    user: {
      id: session.user.id,
      kind: session.user.kind,
      displayName: session.user.displayName,
      email: session.user.email,
      loginId: session.user.loginId,
      locale: session.user.locale,
      hasConfirmedTotp: session.user.totpCredential?.confirmedAt != null,
    },
  };
};

/**
 * Fait progresser une session vers ACTIVE apres validation du second facteur.
 *
 * Le jeton est REGENERE : une session elevee ne conserve jamais l'identifiant
 * observe avant l'authentification complete (protection contre la fixation de
 * session).
 */
export const promoteSession = async (
  db: Db,
  params: {
    readonly sessionId: string;
    readonly authMethod: string;
    readonly request: SessionRequestContext;
    readonly elevated?: boolean;
    readonly now?: Date;
  },
): Promise<IssuedSession> => {
  const now = params.now ?? new Date();
  const existing = await db.session.findUnique({
    where: { id: params.sessionId },
    select: { userId: true, authMethods: true, absoluteExpiresAt: true },
  });
  if (existing === null) {
    throw new DomainError('UNAUTHENTICATED', 'Session expiree.');
  }

  const token = generateOpaqueToken(32);
  await db.session.update({
    where: { id: params.sessionId },
    data: { revokedAt: now, revokedReason: 'rotated_after_mfa' },
  });

  const rotated = await db.session.create({
    data: {
      userId: existing.userId,
      tokenHash: hashLookupToken(token),
      status: SessionStatus.ACTIVE,
      authMethods: [...existing.authMethods, params.authMethod],
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_SECONDS * 1000),
      // L'expiration absolue de la session initiale est conservee : la
      // verification du second facteur ne prolonge pas indefiniment l'acces.
      absoluteExpiresAt: existing.absoluteExpiresAt,
      elevatedUntil:
        params.elevated === false ? null : new Date(now.getTime() + STEP_UP_SECONDS * 1000),
      ipHash: digestIp(params.request.ip),
      userAgentDigest: digestUserAgent(params.request.userAgent),
    },
    select: { id: true, status: true, idleExpiresAt: true, absoluteExpiresAt: true },
  });

  return {
    sessionId: rotated.id,
    token,
    status: rotated.status,
    idleExpiresAt: rotated.idleExpiresAt,
    absoluteExpiresAt: rotated.absoluteExpiresAt,
  };
};

/** Ouvre une fenetre de re-authentification forte. */
export const elevateSession = async (
  db: Db,
  sessionId: string,
  now: Date = new Date(),
): Promise<Date> => {
  const elevatedUntil = new Date(now.getTime() + STEP_UP_SECONDS * 1000);
  await db.session.update({ where: { id: sessionId }, data: { elevatedUntil } });
  return elevatedUntil;
};

export const isElevated = (session: LoadedSession, now: Date = new Date()): boolean =>
  session.elevatedUntil !== null && session.elevatedUntil.getTime() > now.getTime();

export const revokeSession = async (
  db: Db,
  sessionId: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> => {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now, revokedReason: reason },
  });
};

/** Revoque toutes les sessions d'un utilisateur (changement de mot de passe, retrait…). */
export const revokeAllSessionsForUser = async (
  db: Db,
  userId: string,
  reason: string,
  options: { readonly exceptSessionId?: string; readonly now?: Date } = {},
): Promise<number> => {
  const now = options.now ?? new Date();
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options.exceptSessionId !== undefined ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: now, revokedReason: reason },
  });
  return result.count;
};

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

/**
 * Le prefixe `__Host-` impose au navigateur : Secure, Path=/ et absence de
 * Domain. Il rend impossible la pose du cookie par un sous-domaine compromis.
 * En developpement HTTP ce prefixe serait refuse, on retombe donc sur un nom
 * simple, uniquement hors production.
 */
export const sessionCookieName = (): string =>
  getEnv().isProduction ? SESSION_COOKIE_NAME : 'familipact_session';

export const setSessionCookie = async (session: IssuedSession): Promise<void> => {
  const store = await cookies();
  store.set(sessionCookieName(), session.token, {
    httpOnly: true,
    secure: getEnv().isProduction,
    sameSite: 'lax',
    path: '/',
    expires: session.absoluteExpiresAt,
  });
};

export const clearSessionCookie = async (): Promise<void> => {
  const store = await cookies();
  store.set(sessionCookieName(), '', {
    httpOnly: true,
    secure: getEnv().isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
};

export const readSessionCookie = async (): Promise<string | null> => {
  const store = await cookies();
  return store.get(sessionCookieName())?.value ?? null;
};
