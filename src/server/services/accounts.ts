import 'server-only';

import { z } from 'zod';
import {
  AuditAction,
  FamilyRole,
  MembershipStatus,
  SessionStatus,
  UserKind,
  UserStatus,
} from '@/generated/prisma/enums';
import { DomainError, conflictError, validationError } from '@/domain/errors';
import { DEFAULT_PARENT_PERMISSIONS } from '@/domain/permissions';
import { isValidTimeZone } from '@/domain/time';
import { recordAudit } from '@/server/audit/audit-log';
import {
  consumeRateLimit,
  clearRateLimit,
  isAccountLocked,
  nextLockState,
} from '@/server/auth/rate-limit';
import {
  createSession,
  type IssuedSession,
  type SessionRequestContext,
} from '@/server/auth/session';
import { consumeDummyPasswordWork, hashPassword, verifyPassword } from '@/server/crypto/hashing';
import { generateHumanCode } from '@/server/crypto/random';
import { prisma, type Db } from '@/server/db/prisma';
import { consumeInvitation, resolveInvitationCode } from './invitations';

/**
 * Creation de comptes et connexion.
 *
 * DEUX POPULATIONS, DEUX REGIMES :
 *
 *   ADULTE — email + mot de passe + TOTP OBLIGATOIRE. Tant que le TOTP n'est
 *   pas confirme, la session reste en PENDING_MFA_ENROLLMENT et ne donne acces
 *   qu'a l'ecran d'enrolement : aucune donnee familiale n'est lisible.
 *
 *   ENFANT — identifiant de connexion + mot de passe, sans email et sans MFA
 *   obligatoire. L'identifiant de connexion est distinct du nom affiche.
 */

// ---------------------------------------------------------------------------
// Regles de mot de passe
// ---------------------------------------------------------------------------

/**
 * 12 caracteres minimum pour un adulte, sans regle de composition arbitraire :
 * les recommandations actuelles (NIST SP 800-63B) privilegient la longueur et
 * la verification contre les mots de passe courants plutot que les classes de
 * caracteres, qui produisent surtout des mots de passe previsibles.
 */
export const ADULT_PASSWORD_MIN_LENGTH = 12;
/** Un enfant tape son mot de passe souvent, parfois sur un petit clavier. */
export const CHILD_PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 200;

/** Mots de passe les plus courants, refuses quelle que soit leur longueur. */
const FORBIDDEN_PASSWORDS: ReadonlySet<string> = new Set([
  'motdepasse',
  'password',
  'password123',
  'azertyuiop',
  'qwertyuiop',
  '123456789012',
  'familipact',
  'motdepasse123',
]);

const passwordSchema = (minLength: number) =>
  z
    .string()
    .min(minLength, `Le mot de passe doit contenir au moins ${minLength} caracteres.`)
    .max(PASSWORD_MAX_LENGTH)
    .refine(
      (value) => !FORBIDDEN_PASSWORDS.has(value.toLowerCase().replace(/[\s-]/g, '')),
      'Ce mot de passe est trop courant. Choisissez-en un autre.',
    );

// ---------------------------------------------------------------------------
// Creation d'une famille par un parent proprietaire
// ---------------------------------------------------------------------------

export const parentRegistrationSchema = z.object({
  email: z.email('Adresse e-mail invalide.').max(254),
  password: passwordSchema(ADULT_PASSWORD_MIN_LENGTH),
  displayName: z.string().trim().min(1, 'Indiquez votre prenom.').max(60),
  familyName: z.string().trim().min(1, 'Donnez un nom a votre famille.').max(60),
  timeZone: z.string().default('Europe/Paris').refine(isValidTimeZone, 'Fuseau horaire inconnu.'),
});

export type ParentRegistrationInput = z.infer<typeof parentRegistrationSchema>;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface RegistrationResult {
  readonly userId: string;
  readonly familyId: string;
  readonly session: IssuedSession;
}

/**
 * Cree un compte proprietaire ET sa famille, en une seule transaction.
 *
 * La session ouverte est en PENDING_MFA_ENROLLMENT : le parent est
 * immediatement redirige vers la configuration TOTP, obligatoire avant tout
 * acces aux donnees familiales.
 */
export const registerParentAndFamily = async (
  input: ParentRegistrationInput,
  request: SessionRequestContext,
): Promise<RegistrationResult> => {
  const parsed = parentRegistrationSchema.parse(input);
  const email = normalizeEmail(parsed.email);

  await consumeRateLimit(prisma, 'registration', request.ip ?? 'unknown');

  const passwordHash = await hashPassword(parsed.password);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing !== null) {
      // Message identique a celui d'un succes cote interface : voir la route,
      // qui ne revele jamais si l'adresse existe deja.
      throw conflictError('Un compte existe deja avec cette adresse e-mail.');
    }

    const user = await tx.user.create({
      data: {
        kind: UserKind.ADULT,
        email,
        displayName: parsed.displayName,
        passwordHash,
      },
      select: { id: true },
    });

    const family = await tx.family.create({
      data: { name: parsed.familyName, timeZone: parsed.timeZone },
      select: { id: true },
    });

    await tx.familyMembership.create({
      data: {
        familyId: family.id,
        userId: user.id,
        role: FamilyRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });

    await recordAudit(tx, {
      familyId: family.id,
      actorUserId: user.id,
      actorLabel: parsed.displayName,
      action: AuditAction.FAMILY_CREATED,
      summary: `Famille « ${parsed.familyName} » creee par ${parsed.displayName}.`,
      targetType: 'Family',
      targetId: family.id,
      request,
    });

    return { userId: user.id, familyId: family.id };
  });

  const session = await createSession(prisma, {
    userId: result.userId,
    status: SessionStatus.PENDING_MFA_ENROLLMENT,
    authMethods: ['password'],
    request,
    elevated: true,
  });

  return { ...result, session };
};

// ---------------------------------------------------------------------------
// Parent invite
// ---------------------------------------------------------------------------

export const invitedParentSchema = z.object({
  code: z.string().trim().min(1),
  email: z.email('Adresse e-mail invalide.').max(254),
  password: passwordSchema(ADULT_PASSWORD_MIN_LENGTH),
  displayName: z.string().trim().min(1, 'Indiquez votre prenom.').max(60),
});

export type InvitedParentInput = z.infer<typeof invitedParentSchema>;

/**
 * Cree un compte parent a partir d'un jeton d'invitation.
 *
 * Le role provient EXCLUSIVEMENT du jeton. Le parent invite recoit les
 * permissions par defaut, et sa session reste en PENDING_MFA_ENROLLMENT : il
 * n'exerce aucun privilege tant que son TOTP n'est pas confirme.
 */
export const registerInvitedParent = async (
  input: InvitedParentInput,
  request: SessionRequestContext,
): Promise<RegistrationResult> => {
  const parsed = invitedParentSchema.parse(input);
  const email = normalizeEmail(parsed.email);

  await consumeRateLimit(prisma, 'invitationRedeem', request.ip ?? 'unknown');

  const invitation = await resolveInvitationCode(prisma, parsed.code);
  if (invitation.targetRole !== FamilyRole.ADMIN && invitation.targetRole !== FamilyRole.PARENT) {
    throw validationError('Ce code ne permet pas de creer un compte parent.');
  }

  const passwordHash = await hashPassword(parsed.password);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing !== null) {
      throw conflictError('Un compte existe deja avec cette adresse e-mail.');
    }

    const user = await tx.user.create({
      data: {
        kind: UserKind.ADULT,
        email,
        displayName: parsed.displayName,
        passwordHash,
      },
      select: { id: true },
    });

    // Consomme le jeton DANS la transaction : si la suite echoue, il reste valide.
    await consumeInvitation(tx, {
      invitationId: invitation.id,
      consumedByUserId: user.id,
      expectedRole: invitation.targetRole,
    });

    const membership = await tx.familyMembership.create({
      data: {
        familyId: invitation.familyId,
        userId: user.id,
        role: invitation.targetRole,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (invitation.targetRole === FamilyRole.PARENT) {
      await tx.parentPermissionGrant.createMany({
        data: DEFAULT_PARENT_PERMISSIONS.map((permission) => ({
          membershipId: membership.id,
          permission,
        })),
      });
    }

    await recordAudit(tx, {
      familyId: invitation.familyId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      actorLabel: parsed.displayName,
      action: AuditAction.INVITATION_CONSUMED,
      summary: `${parsed.displayName} rejoint la famille en tant que ${invitation.targetRole}. Les privileges seront effectifs une fois la double authentification configuree.`,
      targetType: 'FamilyMembership',
      targetId: membership.id,
      metadata: {
        invitationId: invitation.id,
        targetRole: invitation.targetRole,
        membershipId: membership.id,
      },
      request,
    });

    return { userId: user.id, familyId: invitation.familyId };
  });

  const session = await createSession(prisma, {
    userId: result.userId,
    status: SessionStatus.PENDING_MFA_ENROLLMENT,
    authMethods: ['password'],
    request,
    elevated: true,
  });

  return { ...result, session };
};

// ---------------------------------------------------------------------------
// Enfant invite
// ---------------------------------------------------------------------------

export const childRegistrationSchema = z.object({
  code: z.string().trim().min(1),
  displayName: z.string().trim().min(1, 'Indique ton prenom.').max(40),
  loginId: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "L'identifiant doit contenir au moins 3 caracteres.")
    .max(30)
    .regex(
      /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
      "L'identifiant ne peut contenir que des lettres, chiffres, points, tirets et underscores.",
    ),
  password: passwordSchema(CHILD_PASSWORD_MIN_LENGTH),
});

export type ChildRegistrationInput = z.infer<typeof childRegistrationSchema>;

/**
 * Propose un identifiant de connexion disponible a partir d'un prenom.
 * Le suffixe aleatoire evite les collisions entre familles sans exposer de
 * compteur global.
 */
export const suggestChildLoginId = async (db: Db, displayName: string): Promise<string> => {
  const base =
    displayName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 16) || 'enfant';

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${base}.${generateHumanCode(4).toLowerCase()}`;
    const taken = await db.user.findUnique({ where: { loginId: candidate }, select: { id: true } });
    if (taken === null) return candidate;
  }
  return `${base}.${generateHumanCode(8).toLowerCase()}`;
};

export const registerInvitedChild = async (
  input: ChildRegistrationInput,
  request: SessionRequestContext,
): Promise<RegistrationResult> => {
  const parsed = childRegistrationSchema.parse(input);

  await consumeRateLimit(prisma, 'invitationRedeem', request.ip ?? 'unknown');

  const invitation = await resolveInvitationCode(prisma, parsed.code);
  if (invitation.targetRole !== FamilyRole.CHILD) {
    // Un jeton parent ne cree jamais un compte enfant, et inversement.
    throw validationError('Ce code ne permet pas de creer un compte enfant.');
  }

  const passwordHash = await hashPassword(parsed.password);

  const result = await prisma.$transaction(async (tx) => {
    const taken = await tx.user.findUnique({
      where: { loginId: parsed.loginId },
      select: { id: true },
    });
    if (taken !== null) {
      throw conflictError('Cet identifiant est deja pris. Essaie une autre variante.');
    }

    const user = await tx.user.create({
      data: {
        kind: UserKind.CHILD,
        loginId: parsed.loginId,
        displayName: parsed.displayName,
        passwordHash,
      },
      select: { id: true },
    });

    await consumeInvitation(tx, {
      invitationId: invitation.id,
      consumedByUserId: user.id,
      expectedRole: FamilyRole.CHILD,
    });

    const membership = await tx.familyMembership.create({
      data: {
        familyId: invitation.familyId,
        userId: user.id,
        role: FamilyRole.CHILD,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });

    await tx.childProfile.create({
      data: { membershipId: membership.id, familyId: invitation.familyId },
    });

    await recordAudit(tx, {
      familyId: invitation.familyId,
      actorUserId: user.id,
      actorMembershipId: membership.id,
      actorLabel: parsed.displayName,
      action: AuditAction.CHILD_CREATED,
      summary: `${parsed.displayName} rejoint la famille.`,
      targetType: 'FamilyMembership',
      targetId: membership.id,
      metadata: {
        invitationId: invitation.id,
        childMembershipId: membership.id,
        childName: parsed.displayName,
      },
      request,
    });

    return { userId: user.id, familyId: invitation.familyId };
  });

  // Un enfant n'a pas de MFA obligatoire : sa session est immediatement active.
  const session = await createSession(prisma, {
    userId: result.userId,
    status: SessionStatus.ACTIVE,
    authMethods: ['password'],
    request,
  });

  return { ...result, session };
};

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Indiquez votre identifiant.').max(254),
  password: z.string().min(1, 'Indiquez votre mot de passe.').max(PASSWORD_MAX_LENGTH),
});

export type LoginInput = z.infer<typeof loginSchema>;

export interface LoginResult {
  readonly session: IssuedSession;
  readonly userKind: UserKind;
  /** L'interface redirige vers l'enrolement, la verification, ou l'accueil. */
  readonly nextStep: 'MFA_ENROLLMENT' | 'MFA_VERIFICATION' | 'READY';
}

/**
 * Connexion par mot de passe.
 *
 * Protections cumulees :
 *   - rate limit par identifiant ET par IP ;
 *   - verrouillage temporaire du compte apres 10 echecs ;
 *   - travail de hachage factice quand le compte n'existe pas, pour que le
 *     temps de reponse ne trahisse pas l'existence d'une adresse ;
 *   - message d'erreur unique, sans distinction identifiant/mot de passe.
 *
 * Pour un adulte, le succes du mot de passe n'ouvre JAMAIS une session
 * complete : la session reste en attente du second facteur.
 */
export const login = async (
  input: LoginInput,
  request: SessionRequestContext,
): Promise<LoginResult> => {
  const parsed = loginSchema.parse(input);
  const identifier = parsed.identifier.trim();
  const lookupKey = identifier.toLowerCase();

  await consumeRateLimit(prisma, 'loginByIp', request.ip ?? 'unknown');
  await consumeRateLimit(prisma, 'loginByIdentifier', lookupKey);

  const user = await prisma.user.findFirst({
    where: identifier.includes('@') ? { email: lookupKey } : { loginId: lookupKey },
    select: {
      id: true,
      kind: true,
      status: true,
      displayName: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
      memberships: { select: { familyId: true }, take: 1 },
      totpCredential: { select: { confirmedAt: true } },
    },
  });

  const invalidCredentials = new DomainError(
    'UNAUTHENTICATED',
    'Identifiant ou mot de passe incorrect.',
  );

  if (user === null) {
    // Consomme un temps de calcul comparable a une verification reelle.
    await consumeDummyPasswordWork();
    throw invalidCredentials;
  }

  if (user.status !== UserStatus.ACTIVE) {
    await consumeDummyPasswordWork();
    throw invalidCredentials;
  }

  if (isAccountLocked(user)) {
    throw new DomainError(
      'RATE_LIMITED',
      'Ce compte est temporairement verrouille apres plusieurs tentatives. Reessayez dans quelques minutes.',
    );
  }

  const passwordMatches = await verifyPassword(user.passwordHash, parsed.password);

  if (!passwordMatches) {
    const lockState = nextLockState(user.failedLoginCount);
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lockState.failedLoginCount, lockedUntil: lockState.lockedUntil },
    });
    await recordAudit(prisma, {
      familyId: user.memberships[0]?.familyId ?? null,
      actorUserId: user.id,
      actorLabel: user.displayName,
      action:
        user.kind === UserKind.ADULT
          ? AuditAction.PARENT_LOGIN_FAILED
          : AuditAction.CHILD_LOGIN_FAILED,
      summary: `Echec de connexion pour ${user.displayName}.`,
      request,
    });
    throw invalidCredentials;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await clearRateLimit(prisma, 'loginByIdentifier', lookupKey);

  const hasConfirmedTotp = user.totpCredential?.confirmedAt != null;
  const status =
    user.kind === UserKind.CHILD
      ? SessionStatus.ACTIVE
      : hasConfirmedTotp
        ? SessionStatus.PENDING_MFA
        : SessionStatus.PENDING_MFA_ENROLLMENT;

  const session = await createSession(prisma, {
    userId: user.id,
    status,
    authMethods: ['password'],
    request,
    // Une session enfant ou en attente de MFA n'est jamais « elevee » : les
    // operations sensibles exigeront de toute facon une verification fraiche.
    elevated: status === SessionStatus.PENDING_MFA_ENROLLMENT,
  });

  await recordAudit(prisma, {
    familyId: user.memberships[0]?.familyId ?? null,
    actorUserId: user.id,
    actorLabel: user.displayName,
    action:
      user.kind === UserKind.ADULT
        ? AuditAction.PARENT_LOGIN_SUCCEEDED
        : AuditAction.CHILD_LOGIN_SUCCEEDED,
    summary: `${user.displayName} s'est connecte.`,
    metadata: { sessionId: session.sessionId },
    request,
  });

  return {
    session,
    userKind: user.kind,
    nextStep:
      status === SessionStatus.ACTIVE
        ? 'READY'
        : status === SessionStatus.PENDING_MFA
          ? 'MFA_VERIFICATION'
          : 'MFA_ENROLLMENT',
  };
};

export { passwordSchema };
