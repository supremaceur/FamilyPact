import 'server-only';

import { Secret, TOTP } from 'otpauth';
import { getEnv } from '@/lib/env';
import { open, seal, type SealedSecret } from '@/server/crypto/secret-box';

/**
 * TOTP conforme a la RFC 6238.
 *
 * Parametres volontairement standards (SHA-1, 6 chiffres, periode 30 s) : ce
 * sont les seuls universellement acceptes par Google Authenticator, Microsoft
 * Authenticator, Duo Mobile et les gestionnaires de mots de passe. Choisir
 * SHA-256 rendrait le QR code inexploitable par une partie des applications,
 * pour un gain de securite nul a cette echelle.
 */
export const TOTP_ALGORITHM = 'SHA1';
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD = 30;

/**
 * Tolerance d'un pas de temps de part et d'autre (±30 s), pour absorber la
 * derive d'horloge des telephones sans elargir inutilement la fenetre d'attaque.
 */
export const TOTP_WINDOW = 1;

export interface GeneratedTotpSecret {
  /** Secret en base32, a n'afficher qu'une fois pendant l'enrolement. */
  readonly base32: string;
  /** URI otpauth:// a encoder en QR code. */
  readonly otpauthUrl: string;
  readonly sealed: SealedSecret;
}

const buildTotp = (secretBase32: string, label: string, issuer: string): TOTP =>
  new TOTP({
    issuer,
    label,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });

/**
 * Cree un nouveau secret TOTP, deja chiffre pour le stockage.
 * `userId` sert de donnee associee au chiffrement : le secret est inutilisable
 * s'il est deplace vers un autre compte.
 */
export const generateTotpSecret = (userId: string, accountLabel: string): GeneratedTotpSecret => {
  const env = getEnv();
  // 20 octets = 160 bits, la taille recommandee par la RFC 4226.
  const secret = new Secret({ size: 20 });
  const totp = buildTotp(secret.base32, accountLabel, env.WEBAUTHN_RP_NAME);

  return {
    base32: secret.base32,
    otpauthUrl: totp.toString(),
    sealed: seal(secret.base32, userId),
  };
};

export interface StoredTotpSecret {
  readonly secretCiphertext: string;
  readonly secretNonce: string;
  readonly secretAuthTag: string;
}

export interface TotpVerificationResult {
  readonly valid: boolean;
  /** Pas de temps consomme, a memoriser pour interdire le rejeu du meme code. */
  readonly timeStep: number | null;
}

/**
 * Verifie un code a 6 chiffres.
 *
 * Le pas de temps valide est retourne : l'appelant doit refuser un code dont le
 * pas est inferieur ou egal au dernier pas deja consomme. Sans cela, un code
 * intercepte resterait rejouable pendant sa fenetre de validite.
 */
export const verifyTotpCode = (
  stored: StoredTotpSecret,
  userId: string,
  code: string,
  options: { readonly lastUsedTimeStep: bigint | null; readonly now?: Date },
): TotpVerificationResult => {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { valid: false, timeStep: null };

  let base32: string;
  try {
    base32 = open(
      {
        ciphertext: stored.secretCiphertext,
        nonce: stored.secretNonce,
        authTag: stored.secretAuthTag,
      },
      userId,
    );
  } catch {
    return { valid: false, timeStep: null };
  }

  const now = options.now ?? new Date();
  const totp = buildTotp(base32, userId, getEnv().WEBAUTHN_RP_NAME);
  const delta = totp.validate({ token: normalized, window: TOTP_WINDOW, timestamp: now.getTime() });
  if (delta === null) return { valid: false, timeStep: null };

  const currentStep = Math.floor(now.getTime() / 1000 / TOTP_PERIOD);
  const timeStep = currentStep + delta;

  if (options.lastUsedTimeStep !== null && BigInt(timeStep) <= options.lastUsedTimeStep) {
    // Rejeu d'un code deja consomme.
    return { valid: false, timeStep: null };
  }

  return { valid: true, timeStep };
};

/** Verifie un code pendant l'enrolement, ou aucun pas n'a encore ete consomme. */
export const verifyEnrollmentCode = (
  secretBase32: string,
  code: string,
  now: Date = new Date(),
): { readonly valid: boolean; readonly timeStep: number | null } => {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { valid: false, timeStep: null };

  const totp = buildTotp(secretBase32, 'enrollment', getEnv().WEBAUTHN_RP_NAME);
  const delta = totp.validate({ token: normalized, window: TOTP_WINDOW, timestamp: now.getTime() });
  if (delta === null) return { valid: false, timeStep: null };

  return { valid: true, timeStep: Math.floor(now.getTime() / 1000 / TOTP_PERIOD) + delta };
};
