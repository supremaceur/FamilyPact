import 'server-only';

import { headers } from 'next/headers';
import { cache } from 'react';
import { FamilyRole, MembershipStatus, SessionStatus, UserKind } from '@/generated/prisma/enums';
import { DomainError, forbiddenError } from '@/domain/errors';
import { can, type Capability, requiresStepUp } from '@/domain/permissions';
import type { ParentPermission } from '@/generated/prisma/enums';
import { prisma, type Db } from '@/server/db/prisma';
import {
  isElevated,
  loadSessionByToken,
  readSessionCookie,
  type LoadedSession,
  type SessionRequestContext,
} from './session';

/**
 * Contexte d'autorisation — point de passage OBLIGATOIRE de toute lecture ou
 * ecriture metier.
 *
 * L'interface ne fait que refleter ce que ces fonctions autorisent. Aucune route
 * ne doit interroger la base sans etre passee par `requireFamilyActor`, qui
 * fournit le `familyId` servant a cloisonner toutes les requetes suivantes.
 */

export interface FamilyActor {
  readonly familyId: string;
  readonly membershipId: string;
  readonly role: FamilyRole;
  readonly permissions: readonly ParentPermission[];
  readonly session: LoadedSession;
  readonly userId: string;
  readonly displayName: string;
  readonly timeZone: string;
  readonly familyName: string;
}

/**
 * Contexte reseau de la requete.
 *
 * `x-forwarded-for` n'est digne de confiance que derriere un proxy maitrise ;
 * il ne sert ici qu'a alimenter le rate limiting et des journaux pseudonymises,
 * jamais a autoriser quoi que ce soit.
 *
 * Hors d'une requete HTTP — job planifie, seed, test — il n'existe simplement
 * aucun contexte reseau : la fonction rend alors un contexte vide plutot que
 * d'echouer. Un service reste ainsi appelable depuis n'importe quel point
 * d'entree, ce qui est precisement la propriete recherchee pour la couche
 * metier.
 */
export const getRequestContext = async (): Promise<SessionRequestContext> => {
  try {
    const headerList = await headers();
    const forwardedFor = headerList.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? null;
    return {
      ip: ip !== null && ip.length > 0 ? ip : null,
      userAgent: headerList.get('user-agent'),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
};

/**
 * Session courante, ou `null`.
 *
 * `cache()` deduplique l'appel a l'echelle d'un rendu : plusieurs composants
 * serveur peuvent demander la session sans multiplier les requetes SQL.
 */
export const getCurrentSession = cache(async (): Promise<LoadedSession | null> => {
  const token = await readSessionCookie();
  if (token === null) return null;
  return loadSessionByToken(prisma, token);
});

export const requireSession = async (): Promise<LoadedSession> => {
  const session = await getCurrentSession();
  if (session === null) {
    throw new DomainError('UNAUTHENTICATED', 'Connectez-vous pour continuer.');
  }
  return session;
};

/**
 * Session pleinement authentifiee.
 *
 * Un compte adulte dont le MFA n'est pas configure, ou dont le second facteur
 * n'a pas encore ete fourni, n'atteint jamais les donnees familiales : il est
 * renvoye vers l'enrolement ou la verification.
 */
export const requireActiveSession = async (): Promise<LoadedSession> => {
  const session = await requireSession();
  switch (session.status) {
    case SessionStatus.ACTIVE:
      return session;
    case SessionStatus.PENDING_MFA_ENROLLMENT:
      throw new DomainError(
        'MFA_ENROLLMENT_REQUIRED',
        'Terminez la configuration de la double authentification pour acceder a votre famille.',
      );
    case SessionStatus.PENDING_MFA:
      throw new DomainError('MFA_REQUIRED', 'Saisissez votre code de verification.');
  }
};

/**
 * Verrou de securite complementaire : un compte adulte ACTIF doit posseder un
 * TOTP confirme. Si le TOTP disparait (incident, migration), l'acces est coupe
 * plutot que degrade silencieusement.
 */
const assertAdultMfaPolicy = (session: LoadedSession): void => {
  if (session.user.kind === UserKind.ADULT && !session.user.hasConfirmedTotp) {
    throw new DomainError(
      'MFA_ENROLLMENT_REQUIRED',
      "Votre compte doit disposer d'une double authentification active.",
    );
  }
};

/**
 * Resout l'adhesion familiale de l'utilisateur connecte.
 *
 * `familyId` peut etre precise pour verifier explicitement qu'une ressource
 * appartient bien a la famille de l'utilisateur ; sans lui, l'adhesion active
 * de l'utilisateur est utilisee. Dans les deux cas, le `familyId` retourne est
 * celui de l'ADHESION, jamais celui fourni par le client.
 */
export const requireFamilyActor = async (
  options: { readonly familyId?: string; readonly db?: Db } = {},
): Promise<FamilyActor> => {
  const session = await requireActiveSession();
  assertAdultMfaPolicy(session);

  const db = options.db ?? prisma;
  const memberships = await db.familyMembership.findMany({
    where: {
      userId: session.user.id,
      status: MembershipStatus.ACTIVE,
      ...(options.familyId !== undefined ? { familyId: options.familyId } : {}),
    },
    orderBy: { joinedAt: 'asc' },
    select: {
      id: true,
      familyId: true,
      role: true,
      permissions: { select: { permission: true } },
      family: { select: { name: true, timeZone: true } },
    },
  });

  const membership = memberships[0];
  if (membership === undefined) {
    // Message identique a « ressource inexistante » : un utilisateur ne doit pas
    // pouvoir deduire l'existence d'une famille a laquelle il n'appartient pas.
    throw forbiddenError("Vous n'avez pas acces a cet espace familial.");
  }

  return {
    familyId: membership.familyId,
    membershipId: membership.id,
    role: membership.role,
    permissions: membership.permissions.map((grant) => grant.permission),
    session,
    userId: session.user.id,
    displayName: session.user.displayName,
    timeZone: membership.family.timeZone,
    familyName: membership.family.name,
  };
};

/** Acteur parent : refuse explicitement les comptes enfants. */
export const requireParentActor = async (
  options: { readonly familyId?: string; readonly db?: Db } = {},
): Promise<FamilyActor> => {
  const actor = await requireFamilyActor(options);
  if (actor.role === FamilyRole.CHILD) {
    throw forbiddenError('Cet espace est reserve aux parents.');
  }
  return actor;
};

/** Acteur enfant : refuse les comptes parents. */
export const requireChildActor = async (
  options: { readonly db?: Db } = {},
): Promise<FamilyActor> => {
  const actor = await requireFamilyActor(options);
  if (actor.role !== FamilyRole.CHILD) {
    throw forbiddenError('Cet espace est reserve aux enfants.');
  }
  return actor;
};

/**
 * Verifie une capacite, ET la re-authentification recente si l'operation est
 * sensible. Toute ecriture passe par cette fonction.
 */
export const requireCapability = (
  actor: FamilyActor,
  capability: Capability,
  now: Date = new Date(),
): void => {
  if (!can({ role: actor.role, permissions: actor.permissions }, capability)) {
    throw forbiddenError("Vous n'avez pas la permission d'effectuer cette action.");
  }
  if (requiresStepUp(capability) && !isElevated(actor.session, now)) {
    throw new DomainError(
      'STEP_UP_REQUIRED',
      'Cette action sensible demande une nouvelle verification de votre identite.',
    );
  }
};

export const hasCapability = (actor: FamilyActor, capability: Capability): boolean =>
  can({ role: actor.role, permissions: actor.permissions }, capability);
