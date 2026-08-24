import 'server-only';

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { AuditAction, SessionStatus } from '@/generated/prisma/enums';
import { DomainError, notFoundError } from '@/domain/errors';
import { recordAudit } from '@/server/audit/audit-log';
import { isElevated, promoteSession, elevateSession } from '@/server/auth/session';
import type { IssuedSession, LoadedSession, SessionRequestContext } from '@/server/auth/session';
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from '@/server/auth/webauthn';
import { prisma } from '@/server/db/prisma';

/**
 * Cles d'acces (passkeys) — Face ID, Touch ID, Windows Hello, biometrie Android.
 *
 * IMPORTANT : enregistrer une passkey ne contourne JAMAIS la politique MFA.
 * L'enrolement exige une session deja pleinement authentifiee ; a l'inverse,
 * s'authentifier par passkey ouvre une session complete parce que la passkey
 * prouve a la fois la possession d'un appareil enrole et, avec
 * `userVerification: 'required'`, la presence de l'utilisateur.
 *
 * Le TOTP reste present en base et redevient le facteur exige des qu'une
 * connexion passe par le mot de passe.
 */

export const passkeyNicknameSchema = z.object({
  nickname: z.string().trim().min(1, 'Donnez un nom a cet appareil.').max(60),
});

export const beginPasskeyRegistration = async (
  session: LoadedSession,
): Promise<PublicKeyCredentialCreationOptionsJSON> => {
  if (session.status !== SessionStatus.ACTIVE) {
    throw new DomainError(
      'MFA_REQUIRED',
      "Terminez votre connexion avant d'enregistrer une cle d'acces.",
    );
  }

  const existing = await prisma.webAuthnCredential.findMany({
    where: { userId: session.user.id },
    select: { credentialId: true },
  });

  return buildRegistrationOptions(prisma, {
    userId: session.user.id,
    userName: session.user.email ?? session.user.loginId ?? session.user.id,
    userDisplayName: session.user.displayName,
    existingCredentialIds: existing.map((credential) => credential.credentialId),
  });
};

export const finishPasskeyRegistration = async (
  session: LoadedSession,
  params: {
    readonly response: RegistrationResponseJSON;
    readonly expectedChallenge: string;
    readonly nickname: string;
  },
  request: SessionRequestContext,
): Promise<{ readonly id: string }> => {
  if (session.status !== SessionStatus.ACTIVE) {
    throw new DomainError('MFA_REQUIRED', 'Terminez votre connexion.');
  }
  const { nickname } = passkeyNicknameSchema.parse({ nickname: params.nickname });

  const verified = await verifyRegistration(prisma, {
    userId: session.user.id,
    response: params.response,
    expectedChallenge: params.expectedChallenge,
  });

  const created = await prisma.$transaction(async (tx) => {
    const credential = await tx.webAuthnCredential.create({
      data: {
        userId: session.user.id,
        credentialId: verified.credentialId,
        publicKey: verified.publicKey,
        counter: verified.counter,
        transports: [...verified.transports],
        deviceType: verified.deviceType,
        backedUp: verified.backedUp,
        aaguid: verified.aaguid,
        nickname,
        platformBound: verified.deviceType === 'singleDevice' || verified.backedUp,
      },
      select: { id: true },
    });

    await recordAudit(tx, {
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      action: AuditAction.PASSKEY_REGISTERED,
      summary: `${session.user.displayName} a enregistre la cle d'acces « ${nickname} ».`,
      targetType: 'WebAuthnCredential',
      targetId: credential.id,
      metadata: { credentialId: credential.id, credentialNickname: nickname },
      request,
    });

    return credential;
  });

  return created;
};

export const beginPasskeyAuthentication = async (
  identifier: string | null,
): Promise<PublicKeyCredentialRequestOptionsJSON> => {
  // Sans identifiant, on emet un defi « discoverable » : le navigateur propose
  // les passkeys disponibles. On evite ainsi de reveler si un compte existe.
  if (identifier === null || identifier.trim().length === 0) {
    return buildAuthenticationOptions(prisma, { userId: null, allowCredentialIds: [] });
  }

  const normalized = identifier.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: normalized.includes('@') ? { email: normalized } : { loginId: normalized },
    select: { id: true, webAuthnCredential: { select: { credentialId: true } } },
  });

  if (user === null) {
    // Un defi est tout de meme emis : l'absence de compte ne doit pas etre
    // observable depuis l'exterieur.
    return buildAuthenticationOptions(prisma, { userId: null, allowCredentialIds: [] });
  }

  return buildAuthenticationOptions(prisma, {
    userId: user.id,
    allowCredentialIds: user.webAuthnCredential.map((credential) => credential.credentialId),
  });
};

export interface PasskeyLoginResult {
  readonly session: IssuedSession;
  readonly userKind: 'ADULT' | 'CHILD';
}

/**
 * Connexion par cle d'acces.
 *
 * La session obtenue est ACTIVE et elevee : la passkey a deja verifie
 * l'utilisateur. Aucune connexion par mot de passe n'est ainsi contournee,
 * puisqu'aucun mot de passe n'a ete presente.
 */
export const loginWithPasskey = async (
  params: {
    readonly response: AuthenticationResponseJSON;
    readonly expectedChallenge: string;
  },
  request: SessionRequestContext,
): Promise<PasskeyLoginResult> => {
  const credential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: params.response.id },
    select: {
      id: true,
      credentialId: true,
      publicKey: true,
      counter: true,
      transports: true,
      nickname: true,
      user: { select: { id: true, kind: true, status: true, displayName: true } },
    },
  });
  if (credential === null || credential.user.status !== 'ACTIVE') {
    throw new DomainError('UNAUTHENTICATED', "Cette cle d'acces n'est pas reconnue.");
  }

  await verifyAuthentication(prisma, {
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    credential: {
      id: credential.id,
      credentialId: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports,
    },
  });

  const { createSession } = await import('@/server/auth/session');
  const session = await createSession(prisma, {
    userId: credential.user.id,
    status: SessionStatus.ACTIVE,
    authMethods: ['passkey'],
    request,
    elevated: true,
  });

  await recordAudit(prisma, {
    actorUserId: credential.user.id,
    actorLabel: credential.user.displayName,
    action:
      credential.user.kind === 'ADULT'
        ? AuditAction.PARENT_LOGIN_SUCCEEDED
        : AuditAction.CHILD_LOGIN_SUCCEEDED,
    summary: `${credential.user.displayName} s'est connecte avec la cle d'acces « ${credential.nickname} ».`,
    metadata: { sessionId: session.sessionId, credentialNickname: credential.nickname },
    request,
  });

  return { session, userKind: credential.user.kind };
};

/** Re-authentification forte par cle d'acces, pour une session deja active. */
export const stepUpWithPasskey = async (
  session: LoadedSession,
  params: {
    readonly response: AuthenticationResponseJSON;
    readonly expectedChallenge: string;
  },
  request: SessionRequestContext,
): Promise<Date> => {
  if (session.status !== SessionStatus.ACTIVE) {
    throw new DomainError('UNAUTHENTICATED', 'Session invalide.');
  }

  const credential = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: params.response.id },
    select: {
      id: true,
      userId: true,
      credentialId: true,
      publicKey: true,
      counter: true,
      transports: true,
    },
  });
  if (credential === null || credential.userId !== session.user.id) {
    throw new DomainError('UNAUTHENTICATED', "Cette cle d'acces n'est pas reconnue.");
  }

  await verifyAuthentication(prisma, {
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    credential: {
      id: credential.id,
      credentialId: credential.credentialId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports,
    },
  });

  const elevatedUntil = await elevateSession(prisma, session.id);
  await recordAudit(prisma, {
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    action: AuditAction.STEP_UP_GRANTED,
    summary: `Re-authentification par cle d'acces reussie pour ${session.user.displayName}.`,
    request,
  });
  return elevatedUntil;
};

/**
 * Supprime une cle d'acces.
 *
 * Operation sensible : elle reduit les moyens d'authentification du compte.
 * Elle ne peut jamais retirer le TOTP, qui reste la protection de reference.
 */
export const removePasskey = async (
  session: LoadedSession,
  credentialRecordId: string,
  request: SessionRequestContext,
): Promise<void> => {
  if (!isElevated(session)) {
    throw new DomainError(
      'STEP_UP_REQUIRED',
      "Verifiez votre identite avant de supprimer une cle d'acces.",
    );
  }

  const credential = await prisma.webAuthnCredential.findFirst({
    where: { id: credentialRecordId, userId: session.user.id },
    select: { id: true, nickname: true },
  });
  if (credential === null) throw notFoundError("Cette cle d'acces est introuvable.");

  await prisma.$transaction(async (tx) => {
    await tx.webAuthnCredential.delete({ where: { id: credential.id } });
    await recordAudit(tx, {
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      action: AuditAction.PASSKEY_REMOVED,
      summary: `${session.user.displayName} a supprime la cle d'acces « ${credential.nickname} ».`,
      metadata: { credentialNickname: credential.nickname },
      request,
    });
  });
};

export const listPasskeys = async (userId: string) =>
  prisma.webAuthnCredential.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      nickname: true,
      createdAt: true,
      lastUsedAt: true,
      backedUp: true,
      deviceType: true,
    },
  });

export { promoteSession };
