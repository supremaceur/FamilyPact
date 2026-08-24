import 'server-only';

import { renderSVG } from 'uqr';
import { z } from 'zod';
import { AuditAction, SessionStatus, UserKind } from '@/generated/prisma/enums';
import {
  DomainError,
  conflictError,
  forbiddenError,
  notFoundError,
  validationError,
} from '@/domain/errors';
import { recordAudit } from '@/server/audit/audit-log';
import { getRequestContext, type FamilyActor } from '@/server/auth/context';
import { consumeRateLimit } from '@/server/auth/rate-limit';
import { findMatchingRecoveryCode, generateRecoveryCodes } from '@/server/auth/recovery-codes';
import {
  elevateSession,
  isElevated,
  promoteSession,
  revokeAllSessionsForUser,
  type IssuedSession,
  type LoadedSession,
  type SessionRequestContext,
} from '@/server/auth/session';
import { generateTotpSecret, verifyEnrollmentCode, verifyTotpCode } from '@/server/auth/totp';
import { open } from '@/server/crypto/secret-box';
import { prisma } from '@/server/db/prisma';

/**
 * Double authentification des comptes parents.
 *
 * POLITIQUE (docs/authentication.md) :
 *   1. tout compte ADULTE doit avoir un TOTP confirme ;
 *   2. une connexion par mot de passe declenche TOUJOURS le controle TOTP ;
 *   3. une cle d'acces (passkey) vaut authentification forte et ouvre une
 *      session complete, mais ne remplace jamais le TOTP en base ;
 *   4. les operations sensibles exigent une re-authentification recente ;
 *   5. un parent ne peut pas supprimer sa protection MFA et conserver ses
 *      privileges : reinitialiser le TOTP replace immediatement le compte en
 *      etat d'enrolement, sans acces aux donnees familiales.
 */

export const totpCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Le code doit contenir 6 chiffres.'),
});

export interface TotpEnrollmentChallenge {
  readonly otpauthUrl: string;
  readonly secretBase32: string;
  readonly qrCodeSvg: string;
}

/**
 * Demarre (ou reprend) l'enrolement TOTP.
 *
 * Le secret est stocke NON CONFIRME : tant que l'utilisateur n'a pas prouve
 * qu'il l'a bien enregistre en fournissant un code valide, il ne protege rien
 * et n'ouvre aucun droit.
 */
export const beginTotpEnrollment = async (
  session: LoadedSession,
): Promise<TotpEnrollmentChallenge> => {
  if (session.user.kind !== UserKind.ADULT) {
    throw forbiddenError("La double authentification n'est requise que pour les comptes parents.");
  }
  if (session.user.hasConfirmedTotp && !isElevated(session)) {
    // Remplacer un TOTP existant est une operation sensible.
    throw new DomainError(
      'STEP_UP_REQUIRED',
      'Verifiez votre identite avant de modifier votre double authentification.',
    );
  }

  const accountLabel = session.user.email ?? session.user.displayName;
  const generated = generateTotpSecret(session.user.id, accountLabel);

  await prisma.totpCredential.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      secretCiphertext: generated.sealed.ciphertext,
      secretNonce: generated.sealed.nonce,
      secretAuthTag: generated.sealed.authTag,
    },
    update: {
      secretCiphertext: generated.sealed.ciphertext,
      secretNonce: generated.sealed.nonce,
      secretAuthTag: generated.sealed.authTag,
      confirmedAt: null,
      lastUsedTimeStep: null,
    },
  });

  return {
    otpauthUrl: generated.otpauthUrl,
    secretBase32: generated.base32,
    // SVG inline : aucun appel reseau, donc compatible avec une CSP stricte.
    qrCodeSvg: renderSVG(generated.otpauthUrl, { border: 1 }),
  };
};

export interface EnrollmentConfirmation {
  readonly recoveryCodes: readonly string[];
  readonly session: IssuedSession;
}

/**
 * Confirme l'enrolement : le TOTP devient obligatoire pour ce compte, des codes
 * de recuperation sont emis, et la session devient complete.
 */
export const confirmTotpEnrollment = async (
  session: LoadedSession,
  code: string,
  request: SessionRequestContext,
): Promise<EnrollmentConfirmation> => {
  totpCodeSchema.parse({ code });
  await consumeRateLimit(prisma, 'totpVerification', session.user.id);

  const credential = await prisma.totpCredential.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      secretCiphertext: true,
      secretNonce: true,
      secretAuthTag: true,
      confirmedAt: true,
    },
  });
  if (credential === null) {
    throw notFoundError('Commencez par generer un QR code.');
  }
  if (credential.confirmedAt !== null) {
    throw conflictError('La double authentification est deja active sur ce compte.');
  }

  const secretBase32 = open(
    {
      ciphertext: credential.secretCiphertext,
      nonce: credential.secretNonce,
      authTag: credential.secretAuthTag,
    },
    session.user.id,
  );

  const verification = verifyEnrollmentCode(secretBase32, code);
  if (!verification.valid || verification.timeStep === null) {
    await recordAudit(prisma, {
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      action: AuditAction.MFA_VERIFICATION_FAILED,
      summary: `Code de verification invalide pendant la configuration pour ${session.user.displayName}.`,
      request,
    });
    throw validationError("Ce code est incorrect. Verifiez l'heure de votre telephone.");
  }

  const generatedCodes = await generateRecoveryCodes();

  await prisma.$transaction(async (tx) => {
    await tx.totpCredential.update({
      where: { id: credential.id },
      data: { confirmedAt: new Date(), lastUsedTimeStep: BigInt(verification.timeStep!) },
    });

    // Les anciens codes de recuperation sont invalides par la nouvelle emission.
    await tx.recoveryCode.deleteMany({ where: { userId: session.user.id } });
    await tx.recoveryCode.createMany({
      data: generatedCodes.records.map((record) => ({
        userId: session.user.id,
        codeHash: record.codeHash,
        label: record.label,
      })),
    });

    await recordAudit(tx, {
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      action: AuditAction.MFA_ENROLLED,
      summary: `Double authentification activee pour ${session.user.displayName}.`,
      request,
    });
    await recordAudit(tx, {
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      action: AuditAction.RECOVERY_CODES_GENERATED,
      summary: `${generatedCodes.plaintext.length} codes de recuperation emis pour ${session.user.displayName}.`,
      request,
    });
  });

  const rotated = await promoteSession(prisma, {
    sessionId: session.id,
    authMethod: 'totp',
    request,
  });

  return { recoveryCodes: generatedCodes.plaintext, session: rotated };
};

/**
 * Verifie le second facteur d'une session en attente et l'active.
 *
 * Le pas de temps consomme est memorise : un code intercepte ne peut pas etre
 * rejoue pendant sa fenetre de validite.
 */
export const verifyTotpForSession = async (
  session: LoadedSession,
  code: string,
  request: SessionRequestContext,
): Promise<IssuedSession> => {
  totpCodeSchema.parse({ code });
  await consumeRateLimit(prisma, 'totpVerification', session.user.id);

  const credential = await prisma.totpCredential.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      secretCiphertext: true,
      secretNonce: true,
      secretAuthTag: true,
      confirmedAt: true,
      lastUsedTimeStep: true,
    },
  });
  if (credential === null || credential.confirmedAt === null) {
    throw new DomainError('MFA_ENROLLMENT_REQUIRED', 'Configurez votre double authentification.');
  }

  const result = verifyTotpCode(credential, session.user.id, code, {
    lastUsedTimeStep: credential.lastUsedTimeStep,
  });

  if (!result.valid || result.timeStep === null) {
    await recordAudit(prisma, {
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      action: AuditAction.MFA_VERIFICATION_FAILED,
      summary: `Code de verification invalide pour ${session.user.displayName}.`,
      request,
    });
    throw validationError('Ce code est incorrect ou a deja ete utilise.');
  }

  await prisma.totpCredential.update({
    where: { id: credential.id },
    data: { lastUsedTimeStep: BigInt(result.timeStep) },
  });

  return promoteSession(prisma, { sessionId: session.id, authMethod: 'totp', request });
};

export const recoveryCodeSchema = z.object({
  code: z.string().trim().min(8).max(40),
});

/**
 * Consomme un code de recuperation a la place du TOTP.
 *
 * Le code est marque utilise DANS une mise a jour conditionnelle : deux
 * requetes concurrentes ne peuvent pas consommer le meme code.
 */
export const verifyRecoveryCodeForSession = async (
  session: LoadedSession,
  code: string,
  request: SessionRequestContext,
): Promise<IssuedSession> => {
  recoveryCodeSchema.parse({ code });
  await consumeRateLimit(prisma, 'recoveryCode', session.user.id);

  const available = await prisma.recoveryCode.findMany({
    where: { userId: session.user.id, usedAt: null },
    select: { id: true, codeHash: true },
  });

  const match = await findMatchingRecoveryCode(available, code);
  if (match === null) {
    await recordAudit(prisma, {
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      action: AuditAction.MFA_VERIFICATION_FAILED,
      summary: `Code de recuperation invalide pour ${session.user.displayName}.`,
      request,
    });
    throw validationError('Ce code de recuperation est invalide ou deja utilise.');
  }

  const consumed = await prisma.recoveryCode.updateMany({
    where: { id: match.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) {
    throw validationError('Ce code de recuperation est invalide ou deja utilise.');
  }

  const remaining = await prisma.recoveryCode.count({
    where: { userId: session.user.id, usedAt: null },
  });

  await recordAudit(prisma, {
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    action: AuditAction.RECOVERY_CODE_USED,
    summary: `Code de recuperation utilise par ${session.user.displayName}. ${remaining} code(s) restant(s).`,
    request,
  });

  return promoteSession(prisma, {
    sessionId: session.id,
    authMethod: 'recovery_code',
    request,
  });
};

/**
 * Regenere les codes de recuperation. Operation sensible : exige une
 * re-authentification recente.
 */
export const regenerateRecoveryCodes = async (actor: FamilyActor): Promise<readonly string[]> => {
  if (!isElevated(actor.session)) {
    throw new DomainError(
      'STEP_UP_REQUIRED',
      'Verifiez votre identite avant de regenerer vos codes de secours.',
    );
  }

  const request = await getRequestContext();
  const generated = await generateRecoveryCodes();

  await prisma.$transaction(async (tx) => {
    await tx.recoveryCode.deleteMany({ where: { userId: actor.userId } });
    await tx.recoveryCode.createMany({
      data: generated.records.map((record) => ({
        userId: actor.userId,
        codeHash: record.codeHash,
        label: record.label,
      })),
    });
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.RECOVERY_CODES_GENERATED,
      summary: `${actor.displayName} a regenere ses codes de recuperation. Les anciens sont invalides.`,
      request,
    });
  });

  return generated.plaintext;
};

/**
 * Re-authentification forte (step-up) par code TOTP, pour une session deja
 * active. Ouvre une fenetre courte pendant laquelle les operations sensibles
 * sont autorisees.
 */
export const stepUpWithTotp = async (
  session: LoadedSession,
  code: string,
  request: SessionRequestContext,
): Promise<Date> => {
  totpCodeSchema.parse({ code });
  if (session.status !== SessionStatus.ACTIVE) {
    throw new DomainError('UNAUTHENTICATED', 'Session invalide.');
  }
  await consumeRateLimit(prisma, 'totpVerification', session.user.id);

  const credential = await prisma.totpCredential.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      secretCiphertext: true,
      secretNonce: true,
      secretAuthTag: true,
      confirmedAt: true,
      lastUsedTimeStep: true,
    },
  });
  if (credential === null || credential.confirmedAt === null) {
    throw new DomainError('MFA_ENROLLMENT_REQUIRED', 'Configurez votre double authentification.');
  }

  const result = verifyTotpCode(credential, session.user.id, code, {
    lastUsedTimeStep: credential.lastUsedTimeStep,
  });
  if (!result.valid || result.timeStep === null) {
    await recordAudit(prisma, {
      actorUserId: session.user.id,
      actorLabel: session.user.displayName,
      action: AuditAction.MFA_VERIFICATION_FAILED,
      summary: `Re-authentification refusee pour ${session.user.displayName}.`,
      request,
    });
    throw validationError('Ce code est incorrect ou a deja ete utilise.');
  }

  await prisma.totpCredential.update({
    where: { id: credential.id },
    data: { lastUsedTimeStep: BigInt(result.timeStep) },
  });

  const elevatedUntil = await elevateSession(prisma, session.id);
  await recordAudit(prisma, {
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    action: AuditAction.STEP_UP_GRANTED,
    summary: `Re-authentification reussie pour ${session.user.displayName}.`,
    request,
  });
  return elevatedUntil;
};

/**
 * Reinitialise la double authentification d'un compte parent.
 *
 * Le compte NE CONSERVE PAS ses privileges : toutes ses sessions sont revoquees
 * et il devra reconfigurer un TOTP avant de retrouver l'acces. Un parent ne
 * peut donc pas desactiver sa protection et continuer a agir.
 */
export const resetOwnMfa = async (actor: FamilyActor): Promise<void> => {
  if (!isElevated(actor.session)) {
    throw new DomainError(
      'STEP_UP_REQUIRED',
      'Verifiez votre identite avant de modifier votre double authentification.',
    );
  }
  const request = await getRequestContext();

  await prisma.$transaction(async (tx) => {
    await tx.totpCredential.deleteMany({ where: { userId: actor.userId } });
    await tx.recoveryCode.deleteMany({ where: { userId: actor.userId } });
    await recordAudit(tx, {
      familyId: actor.familyId,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId,
      actorLabel: actor.displayName,
      action: AuditAction.MFA_RESET,
      summary: `${actor.displayName} a reinitialise sa double authentification. L'acces est suspendu jusqu'a une nouvelle configuration.`,
      request,
    });
  });

  await revokeAllSessionsForUser(prisma, actor.userId, 'mfa_reset');
};
