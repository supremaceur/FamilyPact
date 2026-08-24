import 'server-only';

import { z } from 'zod';

/**
 * Configuration serveur, validee au demarrage.
 *
 * Aucune de ces valeurs n'est exposee au client : ce module importe
 * `server-only`, ce qui fait echouer le build si un composant client
 * l'atteint par erreur.
 */

const base64Key = (bytes: number) =>
  z
    .string()
    .min(1)
    .refine(
      (value) => {
        try {
          return Buffer.from(value, 'base64').length === bytes;
        } catch {
          return false;
        }
      },
      { message: `La cle doit faire ${bytes} octets encodes en base64.` },
    );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire.'),

  TOTP_ENCRYPTION_KEY: base64Key(32),
  LOG_PEPPER_KEY: base64Key(32),

  APP_ORIGIN: z.url({ error: 'APP_ORIGIN doit etre une URL absolue, ex. https://familipact.app' }),
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1).default('FamiliPact'),

  JOB_RUNNER_TOKEN: z.string().min(24, 'JOB_RUNNER_TOKEN doit faire au moins 24 caracteres.'),

  DEFAULT_FAMILY_TIMEZONE: z.string().min(1).default('Europe/Paris'),
  ALLOW_DEV_SEED: z
    .string()
    .optional()
    .transform((value) => value === '1' || value === 'true'),
});

export type ServerEnv = z.infer<typeof schema> & {
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
};

let cached: ServerEnv | null = null;

/**
 * Lit et valide la configuration. Le resultat est memoise : une variable
 * modifiee a chaud n'est pas reprise, ce qui est le comportement voulu en
 * production.
 */
export const getEnv = (): ServerEnv => {
  if (cached !== null) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuration invalide. Verifiez votre fichier .env (voir .env.example) :\n${issues}`,
    );
  }

  const value = parsed.data;
  cached = {
    ...value,
    isProduction: value.NODE_ENV === 'production',
    isDevelopment: value.NODE_ENV === 'development',
    isTest: value.NODE_ENV === 'test',
  };
  return cached;
};

/** Reinitialise le cache — reserve aux tests. */
export const resetEnvCache = (): void => {
  cached = null;
};
