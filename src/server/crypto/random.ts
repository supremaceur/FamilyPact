import 'server-only';

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Alphabet Crockford base32, sans I, L, O ni U : les confusions de saisie
 * (1/I/L, 0/O) sont impossibles, et « U » est ecarte pour eviter les mots
 * malheureux dans un code lu a voix haute en famille.
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Genere un code alphanumerique cryptographiquement sur, saisissable a la main.
 *
 * `randomInt` fournit un tirage uniforme sans biais modulo, contrairement a un
 * `randomBytes[i] % 32` naif.
 */
export const generateHumanCode = (length: number): string => {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  }
  return code;
};

/** Formate un code en groupes de 4 caracteres : "A1B2-C3D4-…". */
export const formatCodeForDisplay = (code: string): string =>
  (code.match(/.{1,4}/g) ?? [code]).join('-');

/**
 * Normalise un code saisi par l'utilisateur : majuscules, suppression des
 * separateurs, et correction des confusions visuelles classiques.
 */
export const normalizeHumanCode = (input: string): string =>
  input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');

/** Jeton opaque de session, encode en base64url. */
export const generateOpaqueToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** Comparaison a temps constant de deux chaines. */
export const constantTimeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    // `timingSafeEqual` exige des longueurs egales ; on compare tout de meme
    // une valeur factice pour ne pas raccourcir le temps de reponse.
    timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
};
