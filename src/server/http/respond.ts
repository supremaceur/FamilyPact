import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { DomainError, isDomainError, type DomainErrorCode } from '@/domain/errors';
import { RateLimitError } from '@/server/auth/rate-limit';
import { getEnv } from '@/lib/env';

/**
 * Traduction des erreurs du domaine en reponses HTTP.
 *
 * Deux principes :
 *   1. le client recoit un message utile mais jamais de detail technique ;
 *   2. « inexistant » et « appartient a une autre famille » renvoient le MEME
 *      statut 404, pour ne pas transformer l'API en oracle d'existence.
 */

const STATUS_BY_CODE: Readonly<Record<DomainErrorCode, number>> = {
  VALIDATION: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  MFA_REQUIRED: 401,
  MFA_ENROLLMENT_REQUIRED: 403,
  STEP_UP_REQUIRED: 403,
  CONFLICT: 409,
  INVALID_STATE: 409,
  RATE_LIMITED: 429,
};

export interface ApiErrorBody {
  readonly error: {
    readonly code: DomainErrorCode | 'INTERNAL';
    readonly message: string;
    readonly fieldErrors?: Record<string, string[]>;
  };
}

export const jsonOk = <T>(data: T, init?: ResponseInit): NextResponse =>
  NextResponse.json(data, { status: 200, ...init });

export const jsonCreated = <T>(data: T): NextResponse => NextResponse.json(data, { status: 201 });

export const jsonError = (
  code: DomainErrorCode | 'INTERNAL',
  message: string,
  status: number,
  extra?: { readonly fieldErrors?: Record<string, string[]>; readonly headers?: HeadersInit },
): NextResponse =>
  NextResponse.json<ApiErrorBody>(
    {
      error: {
        code,
        message,
        ...(extra?.fieldErrors !== undefined ? { fieldErrors: extra.fieldErrors } : {}),
      },
    },
    { status, ...(extra?.headers !== undefined ? { headers: extra.headers } : {}) },
  );

/**
 * Enveloppe un gestionnaire de route.
 *
 * Toute erreur inattendue est journalisee cote serveur et rendue au client sous
 * une forme neutre : ni pile d'appels, ni message de la base de donnees.
 */
export const withErrorHandling = async (
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> => {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof RateLimitError) {
      return jsonError('RATE_LIMITED', error.message, 429, {
        headers: { 'Retry-After': String(error.retryAfterSeconds) },
      });
    }

    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.join('.') || '_';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return jsonError('VALIDATION', 'Certaines informations sont invalides.', 422, {
        fieldErrors,
      });
    }

    if (isDomainError(error)) {
      return jsonError(error.code, error.message, STATUS_BY_CODE[error.code]);
    }

    // Journalisation structuree : le detail reste cote serveur.
    console.error(
      JSON.stringify({
        level: 'error',
        scope: 'api',
        message: error instanceof Error ? error.message : 'unknown error',
        stack: getEnv().isProduction ? undefined : error instanceof Error ? error.stack : undefined,
      }),
    );
    return jsonError('INTERNAL', 'Une erreur est survenue. Reessayez dans un instant.', 500);
  }
};

export { DomainError };
