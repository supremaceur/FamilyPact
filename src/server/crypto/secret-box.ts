import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';

/**
 * Chiffrement au repos des secrets TOTP.
 *
 * Un secret TOTP doit etre reversible (le serveur le rejoue a chaque
 * verification) : il ne peut donc pas etre hashe. AES-256-GCM le protege en
 * confidentialite ET en integrite, avec la cle `TOTP_ENCRYPTION_KEY` qui ne
 * reside jamais en base.
 */

export interface SealedSecret {
  readonly ciphertext: string;
  readonly nonce: string;
  readonly authTag: string;
}

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;

const key = (): Buffer => Buffer.from(getEnv().TOTP_ENCRYPTION_KEY, 'base64');

export const seal = (plaintext: string, associatedData: string): SealedSecret => {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), nonce);
  // Lier le chiffre a l'utilisateur : un secret ne peut pas etre deplace
  // d'un compte a un autre, meme par un acces direct a la base.
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
};

export const open = (sealed: SealedSecret, associatedData: string): string => {
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(sealed.nonce, 'base64'));
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};
