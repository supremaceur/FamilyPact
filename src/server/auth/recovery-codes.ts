import 'server-only';

import {
  formatCodeForDisplay,
  generateHumanCode,
  normalizeHumanCode,
} from '@/server/crypto/random';
import { hashRecoveryCode, verifyRecoveryCode } from '@/server/crypto/hashing';

/**
 * Codes de recuperation : dernier recours si le parent perd son telephone.
 *
 * 10 codes de 10 caracteres Crockford = ~51 bits d'entropie chacun. Ils sont
 * hashes en Argon2id (comme un mot de passe) : la base compromise ne permet pas
 * de les rejouer. Chaque code ne sert qu'une fois.
 */
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 10;

export interface GeneratedRecoveryCodes {
  /** Codes en clair, affiches UNE SEULE fois a l'utilisateur. */
  readonly plaintext: readonly string[];
  readonly records: readonly { readonly codeHash: string; readonly label: string }[];
}

export const generateRecoveryCodes = async (): Promise<GeneratedRecoveryCodes> => {
  const plaintext = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    formatCodeForDisplay(generateHumanCode(RECOVERY_CODE_LENGTH)),
  );

  const records = await Promise.all(
    plaintext.map(async (code) => ({
      codeHash: await hashRecoveryCode(normalizeHumanCode(code)),
      // Prefixe non secret : permet d'afficher « A1B2-… » dans la liste des codes
      // restants sans reveler le code complet.
      label: code.slice(0, 4),
    })),
  );

  return { plaintext, records };
};

export interface StoredRecoveryCode {
  readonly id: string;
  readonly codeHash: string;
}

/**
 * Cherche le code correspondant parmi ceux encore disponibles.
 *
 * Tous les candidats sont testes, sans court-circuit, pour ne pas exposer par
 * le temps de reponse la position du code dans la liste.
 */
export const findMatchingRecoveryCode = async (
  candidates: readonly StoredRecoveryCode[],
  submitted: string,
): Promise<StoredRecoveryCode | null> => {
  const normalized = normalizeHumanCode(submitted);
  if (normalized.length !== RECOVERY_CODE_LENGTH) return null;

  let match: StoredRecoveryCode | null = null;
  for (const candidate of candidates) {
    const matches = await verifyRecoveryCode(candidate.codeHash, normalized);
    if (matches && match === null) match = candidate;
  }
  return match;
};
