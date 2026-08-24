import 'server-only';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { WebAuthnChallengeType } from '@/generated/prisma/enums';
import { DomainError, validationError } from '@/domain/errors';
import { getEnv } from '@/lib/env';
import type { Db } from '@/server/db/prisma';

/**
 * Passkeys / WebAuthn.
 *
 * FamiliPact n'appelle jamais une API biometrique proprietaire : Face ID,
 * Touch ID, Windows Hello et la biometrie Android sont atteints uniquement via
 * WebAuthn, en demandant un authentificateur de PLATEFORME. C'est le navigateur
 * qui declenche la biometrie ; l'application ne voit qu'une signature.
 *
 * POLITIQUE MFA (voir docs/authentication.md) :
 *   - un compte parent DOIT conserver un TOTP confirme ;
 *   - une connexion par mot de passe declenche toujours le controle TOTP ;
 *   - une passkey vaut authentification forte : elle prouve la possession d'un
 *     appareil enrole et, pour un authentificateur de plateforme, la presence
 *     de l'utilisateur. Elle ouvre donc une session ACTIVE directement, sans
 *     jamais permettre de supprimer le TOTP.
 */

const CHALLENGE_TTL_SECONDS = 300;

const relyingParty = () => {
  const env = getEnv();
  return {
    id: env.WEBAUTHN_RP_ID,
    name: env.WEBAUTHN_RP_NAME,
    origin: env.APP_ORIGIN,
  };
};

const storeChallenge = async (
  db: Db,
  challenge: string,
  type: WebAuthnChallengeType,
  userId: string | null,
  now: Date,
): Promise<void> => {
  await db.webAuthnChallenge.create({
    data: {
      challenge,
      type,
      userId,
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000),
    },
  });
};

/**
 * Consomme un challenge : il devient inutilisable, meme si la requete est
 * rejouee. La mise a jour conditionnelle rend l'operation atomique.
 */
const consumeChallenge = async (
  db: Db,
  challenge: string,
  type: WebAuthnChallengeType,
  now: Date,
): Promise<{ readonly userId: string | null } | null> => {
  const record = await db.webAuthnChallenge.findUnique({
    where: { challenge },
    select: { id: true, type: true, userId: true, expiresAt: true, consumedAt: true },
  });
  if (record === null) return null;
  if (record.type !== type) return null;
  if (record.consumedAt !== null) return null;
  if (record.expiresAt.getTime() <= now.getTime()) return null;

  const consumed = await db.webAuthnChallenge.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) return null;

  return { userId: record.userId };
};

// ---------------------------------------------------------------------------
// Enregistrement
// ---------------------------------------------------------------------------

export const buildRegistrationOptions = async (
  db: Db,
  params: {
    readonly userId: string;
    readonly userName: string;
    readonly userDisplayName: string;
    readonly existingCredentialIds: readonly string[];
    readonly now?: Date;
  },
): Promise<PublicKeyCredentialCreationOptionsJSON> => {
  const rp = relyingParty();
  const options = await generateRegistrationOptions({
    rpID: rp.id,
    rpName: rp.name,
    userID: Buffer.from(params.userId, 'utf8'),
    userName: params.userName,
    userDisplayName: params.userDisplayName,
    attestationType: 'none',
    // Empeche d'enregistrer deux fois le meme authentificateur.
    excludeCredentials: params.existingCredentialIds.map((id) => ({ id })),
    authenticatorSelection: {
      // Authentificateur integre a l'appareil : c'est ce qui declenche
      // Face ID / Touch ID / Windows Hello / biometrie Android.
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });

  await storeChallenge(
    db,
    options.challenge,
    WebAuthnChallengeType.REGISTRATION,
    params.userId,
    params.now ?? new Date(),
  );
  return options;
};

export interface VerifiedRegistration {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: bigint;
  readonly transports: readonly string[];
  readonly deviceType: string;
  readonly backedUp: boolean;
  readonly aaguid: string | null;
}

export const verifyRegistration = async (
  db: Db,
  params: {
    readonly userId: string;
    readonly response: RegistrationResponseJSON;
    readonly expectedChallenge: string;
    readonly now?: Date;
  },
): Promise<VerifiedRegistration> => {
  const now = params.now ?? new Date();
  const consumed = await consumeChallenge(
    db,
    params.expectedChallenge,
    WebAuthnChallengeType.REGISTRATION,
    now,
  );
  if (consumed === null || consumed.userId !== params.userId) {
    throw validationError("Le defi d'enregistrement est expire ou invalide.");
  }

  const rp = relyingParty();
  const verification = await verifyRegistrationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
    requireUserVerification: true,
  });

  if (!verification.verified || verification.registrationInfo === undefined) {
    throw validationError("L'enregistrement de la cle d'acces a echoue.");
  }

  const info = verification.registrationInfo;
  return {
    credentialId: info.credential.id,
    publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
    counter: BigInt(info.credential.counter),
    transports: info.credential.transports ?? [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    aaguid: info.aaguid ?? null,
  };
};

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

export const buildAuthenticationOptions = async (
  db: Db,
  params: {
    /** Null pour une authentification « discoverable » sans identifiant prealable. */
    readonly userId: string | null;
    readonly allowCredentialIds: readonly string[];
    readonly now?: Date;
  },
): Promise<PublicKeyCredentialRequestOptionsJSON> => {
  const rp = relyingParty();
  const options = await generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: 'required',
    allowCredentials:
      params.allowCredentialIds.length > 0
        ? params.allowCredentialIds.map((id) => ({ id }))
        : undefined,
  });

  await storeChallenge(
    db,
    options.challenge,
    WebAuthnChallengeType.AUTHENTICATION,
    params.userId,
    params.now ?? new Date(),
  );
  return options;
};

export interface StoredCredential {
  readonly id: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: bigint;
  readonly transports: readonly string[];
}

export interface VerifiedAuthentication {
  readonly credentialRecordId: string;
  readonly newCounter: bigint;
}

export const verifyAuthentication = async (
  db: Db,
  params: {
    readonly response: AuthenticationResponseJSON;
    readonly expectedChallenge: string;
    readonly credential: StoredCredential;
    readonly now?: Date;
  },
): Promise<VerifiedAuthentication> => {
  const now = params.now ?? new Date();
  const consumed = await consumeChallenge(
    db,
    params.expectedChallenge,
    WebAuthnChallengeType.AUTHENTICATION,
    now,
  );
  if (consumed === null) {
    throw new DomainError('UNAUTHENTICATED', 'Le defi est expire ou invalide.');
  }

  const rp = relyingParty();
  const verification = await verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.id,
    requireUserVerification: true,
    credential: {
      id: params.credential.credentialId,
      publicKey: new Uint8Array(Buffer.from(params.credential.publicKey, 'base64url')),
      counter: Number(params.credential.counter),
      // Les transports proviennent de la base sous forme de `string[]` ; le
      // type attendu est l'union fermee `AuthenticatorTransportFuture[]`.
      // La valeur est toujours issue d'un enregistrement WebAuthn valide.
      transports: params.credential.transports as never,
    },
  });

  if (!verification.verified) {
    throw new DomainError('UNAUTHENTICATED', "La cle d'acces n'a pas pu etre verifiee.");
  }

  const newCounter = BigInt(verification.authenticationInfo.newCounter);
  // Un compteur qui n'avance pas trahit un clonage d'authentificateur. Les
  // authentificateurs de plateforme renvoient souvent 0 : on ne rejette donc
  // que les regressions strictes sur un compteur deja non nul.
  if (params.credential.counter > 0n && newCounter <= params.credential.counter) {
    throw new DomainError('UNAUTHENTICATED', "Cette cle d'acces a ete rejetee.");
  }

  await db.webAuthnCredential.update({
    where: { id: params.credential.id },
    data: { counter: newCounter, lastUsedAt: now },
  });

  return { credentialRecordId: params.credential.id, newCounter };
};

/** Supprime les challenges expires (job de maintenance). */
export const purgeExpiredChallenges = async (db: Db, now: Date = new Date()): Promise<number> => {
  const result = await db.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
  return result.count;
};
