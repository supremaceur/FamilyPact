'use client';

/**
 * Client HTTP de l'interface.
 *
 * Toutes les mutations passent par ici afin que la gestion des erreurs, des
 * codes metier et des pertes de reseau soit uniforme. Le serveur reste l'unique
 * source de verite : aucune reponse n'est devinee cote client.
 */

export interface ApiFailure {
  readonly code: string;
  readonly message: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly status: number;
}

export class ApiError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
    this.failure = failure;
  }
}

const NETWORK_MESSAGE = 'Connexion perdue. Verifiez votre reseau puis reessayez.';

export const apiRequest = async <T>(
  path: string,
  options: { readonly method: string; readonly body?: unknown } = { method: 'GET' },
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method,
      headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // Le cookie de session est en `SameSite=Lax` ; `same-origin` suffit et
      // evite d'envoyer les identifiants vers un tiers par accident.
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError({ code: 'NETWORK', message: NETWORK_MESSAGE, status: 0 });
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? (
            payload as {
              error: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
            }
          ).error
        : null;
    throw new ApiError({
      code: error?.code ?? 'INTERNAL',
      message: error?.message ?? 'Une erreur est survenue. Reessayez dans un instant.',
      ...(error?.fieldErrors !== undefined ? { fieldErrors: error.fieldErrors } : {}),
      status: response.status,
    });
  }

  return payload as T;
};

export const apiPost = <T>(path: string, body?: unknown): Promise<T> =>
  apiRequest<T>(path, { method: 'POST', body });
export const apiPut = <T>(path: string, body?: unknown): Promise<T> =>
  apiRequest<T>(path, { method: 'PUT', body });
export const apiPatch = <T>(path: string, body?: unknown): Promise<T> =>
  apiRequest<T>(path, { method: 'PATCH', body });
export const apiDelete = <T>(path: string, body?: unknown): Promise<T> =>
  apiRequest<T>(path, { method: 'DELETE', body });
