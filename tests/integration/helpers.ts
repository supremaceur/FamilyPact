import { randomUUID } from 'node:crypto';
import { FamilyRole, MembershipStatus, SessionStatus, UserKind } from '@/generated/prisma/enums';
import type { ParentPermission } from '@/generated/prisma/enums';
import { ALL_PARENT_PERMISSIONS } from '@/domain/permissions';
import type { FamilyActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';
import { STEP_UP_SECONDS } from '@/server/auth/session';

/**
 * Fabriques de donnees pour les tests d'integration.
 *
 * Les identifiants sont derives d'un compteur et d'un UUID : les donnees sont
 * uniques d'une execution a l'autre sans dependre de l'horloge, ce qui garde
 * les tests deterministes.
 */

let counter = 0;
const nextSuffix = (): string => {
  counter += 1;
  return `${counter}-${randomUUID().slice(0, 8)}`;
};

/**
 * Construit un acteur equivalent a celui que produirait `requireFamilyActor`.
 *
 * Les services recoivent un `FamilyActor` : les tester directement permet de
 * verifier l'autorisation ET la logique metier sans passer par HTTP, tout en
 * gardant la meme frontiere de securite que l'application.
 */
export interface TestActorOptions {
  readonly role?: FamilyRole;
  readonly permissions?: readonly ParentPermission[];
  readonly elevated?: boolean;
  readonly displayName?: string;
}

export interface TestFamily {
  readonly familyId: string;
  readonly timeZone: string;
  readonly ownerActor: FamilyActor;
}

export const createFamily = async (
  options: { readonly name?: string; readonly timeZone?: string } = {},
): Promise<TestFamily> => {
  const suffix = nextSuffix();
  const family = await prisma.family.create({
    data: {
      name: options.name ?? `Famille ${suffix}`,
      timeZone: options.timeZone ?? 'Europe/Paris',
    },
    select: { id: true, name: true, timeZone: true },
  });

  const ownerActor = await addParent(family.id, {
    role: FamilyRole.OWNER,
    displayName: `Owner ${suffix}`,
    elevated: true,
  });

  return { familyId: family.id, timeZone: family.timeZone, ownerActor };
};

export const addParent = async (
  familyId: string,
  options: TestActorOptions = {},
): Promise<FamilyActor> => {
  const suffix = nextSuffix();
  const role = options.role ?? FamilyRole.PARENT;
  const displayName = options.displayName ?? `Parent ${suffix}`;

  const user = await prisma.user.create({
    data: {
      kind: UserKind.ADULT,
      email: `parent-${suffix}@example.test`,
      displayName,
      passwordHash: 'test-hash-not-verified',
      // Un compte adulte doit avoir un TOTP confirme pour agir : on reproduit
      // fidelement cet etat plutot que de le contourner.
      totpCredential: {
        create: {
          secretCiphertext: 'test',
          secretNonce: 'test',
          secretAuthTag: 'test',
          confirmedAt: new Date(),
        },
      },
    },
    select: { id: true },
  });

  const membership = await prisma.familyMembership.create({
    data: {
      familyId,
      userId: user.id,
      role,
      status: MembershipStatus.ACTIVE,
      ...(role === FamilyRole.PARENT && options.permissions !== undefined
        ? {
            permissions: {
              createMany: {
                data: options.permissions.map((permission) => ({ permission })),
              },
            },
          }
        : {}),
    },
    select: { id: true, family: { select: { name: true, timeZone: true } } },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: `test-session-${suffix}`,
      status: SessionStatus.ACTIVE,
      authMethods: ['password', 'totp'],
      idleExpiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      elevatedUntil:
        options.elevated === true ? new Date(Date.now() + STEP_UP_SECONDS * 1000) : null,
    },
    select: { id: true, status: true, authMethods: true, elevatedUntil: true },
  });

  return {
    familyId,
    membershipId: membership.id,
    role,
    permissions:
      role === FamilyRole.PARENT ? (options.permissions ?? []) : [...ALL_PARENT_PERMISSIONS],
    userId: user.id,
    displayName,
    timeZone: membership.family.timeZone,
    familyName: membership.family.name,
    session: {
      id: session.id,
      status: session.status,
      authMethods: session.authMethods,
      elevatedUntil: session.elevatedUntil,
      user: {
        id: user.id,
        kind: UserKind.ADULT,
        displayName,
        email: `parent-${suffix}@example.test`,
        loginId: null,
        locale: 'fr',
        hasConfirmedTotp: true,
      },
    },
  };
};

export interface TestChild {
  readonly membershipId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly actor: FamilyActor;
}

export const addChild = async (
  familyId: string,
  options: { readonly displayName?: string } = {},
): Promise<TestChild> => {
  const suffix = nextSuffix();
  const displayName = options.displayName ?? `Enfant ${suffix}`;

  const user = await prisma.user.create({
    data: {
      kind: UserKind.CHILD,
      loginId: `enfant.${suffix}`,
      displayName,
      passwordHash: 'test-hash-not-verified',
    },
    select: { id: true },
  });

  const membership = await prisma.familyMembership.create({
    data: {
      familyId,
      userId: user.id,
      role: FamilyRole.CHILD,
      status: MembershipStatus.ACTIVE,
      childProfile: { create: { familyId } },
    },
    select: { id: true, family: { select: { name: true, timeZone: true } } },
  });

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: `test-session-${suffix}`,
      status: SessionStatus.ACTIVE,
      authMethods: ['password'],
      idleExpiresAt: new Date(Date.now() + 3_600_000),
      absoluteExpiresAt: new Date(Date.now() + 86_400_000),
    },
    select: { id: true, status: true, authMethods: true, elevatedUntil: true },
  });

  return {
    membershipId: membership.id,
    userId: user.id,
    displayName,
    actor: {
      familyId,
      membershipId: membership.id,
      role: FamilyRole.CHILD,
      permissions: [],
      userId: user.id,
      displayName,
      timeZone: membership.family.timeZone,
      familyName: membership.family.name,
      session: {
        id: session.id,
        status: session.status,
        authMethods: session.authMethods,
        elevatedUntil: session.elevatedUntil,
        user: {
          id: user.id,
          kind: UserKind.CHILD,
          displayName,
          email: null,
          loginId: `enfant.${suffix}`,
          locale: 'fr',
          hasConfirmedTotp: false,
        },
      },
    },
  };
};

/** Solde lu directement depuis le ledger, sans passer par le cache. */
export const ledgerBalance = async (
  familyId: string,
  childMembershipId: string,
): Promise<number> => {
  const aggregate = await prisma.pointTransaction.aggregate({
    where: { familyId, childMembershipId },
    _sum: { delta: true },
  });
  return aggregate._sum.delta ?? 0;
};

/** Solde lu depuis le cache maintenu par la couche service. */
export const cachedBalance = async (childMembershipId: string): Promise<number> => {
  const profile = await prisma.childProfile.findUniqueOrThrow({
    where: { membershipId: childMembershipId },
    select: { cachedBalance: true },
  });
  return profile.cachedBalance;
};
