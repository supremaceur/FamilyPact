/**
 * Erreurs du domaine.
 *
 * Le domaine ne connait ni HTTP ni Prisma : il signale des situations metier.
 * La couche transport (src/server/http) traduit ces erreurs en statuts et en
 * messages utilisateur. Aucun message d'erreur ne doit reveler l'existence
 * d'une ressource appartenant a une autre famille.
 */

export type DomainErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'MFA_ENROLLMENT_REQUIRED'
  | 'STEP_UP_REQUIRED'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'RATE_LIMITED';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export const validationError = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('VALIDATION', message, details);

/**
 * Utilisee aussi bien pour "la ressource n'existe pas" que pour "elle existe
 * mais dans une autre famille" : les deux cas doivent etre indiscernables.
 */
export const notFoundError = (message = 'Ressource introuvable.'): DomainError =>
  new DomainError('NOT_FOUND', message);

export const forbiddenError = (message = 'Action non autorisee.'): DomainError =>
  new DomainError('FORBIDDEN', message);

export const conflictError = (message: string, details?: Record<string, unknown>): DomainError =>
  new DomainError('CONFLICT', message, details);

export const invalidStateError = (
  message: string,
  details?: Record<string, unknown>,
): DomainError => new DomainError('INVALID_STATE', message, details);

export const isDomainError = (error: unknown): error is DomainError => error instanceof DomainError;
