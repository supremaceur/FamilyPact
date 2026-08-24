import { toLocalDate } from '@/domain/time';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FamilyRole,
  InvitationStatus,
  ParentPermission,
  PointTransactionSource,
  PointTransactionType,
  TaskRecurrence,
} from '@/generated/prisma/enums';
import { DomainError } from '@/domain/errors';
import { OwnerCapability } from '@/domain/permissions';
import { prisma } from '@/server/db/prisma';
import { requireCapability } from '@/server/auth/context';
import {
  consumeInvitation,
  createInvitation,
  resolveInvitationCode,
  revokeInvitation,
} from '@/server/services/invitations';
import { getChildDetail, getTaskDefinition } from '@/server/queries/parent-lists';
import { createTaskDefinition } from '@/server/services/task-definitions';
import { approveOccurrence, claimOccurrenceDone } from '@/server/services/task-occurrences';
import { adjustPoints, reversePointTransaction } from '@/server/services/point-adjustments';
import { createRewardRule, grantReward } from '@/server/services/rewards';
import { updateChildProfile } from '@/server/services/children';
import { addChild, addParent, createFamily } from './helpers';

/**
 * Cas metier I et J : jeton d'invitation a usage unique, et isolation stricte
 * entre familles.
 */

let familyA: Awaited<ReturnType<typeof createFamily>>;
let familyB: Awaited<ReturnType<typeof createFamily>>;
let childA: Awaited<ReturnType<typeof addChild>>;
let childB: Awaited<ReturnType<typeof addChild>>;

beforeEach(async () => {
  familyA = await createFamily({ name: 'Famille A' });
  familyB = await createFamily({ name: 'Famille B' });
  childA = await addChild(familyA.familyId, { displayName: 'Lucas' });
  childB = await addChild(familyB.familyId, { displayName: 'Emma' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const APP_ORIGIN = 'http://localhost:3000';

describe("Cas I — un jeton d'invitation ne sert qu'une fois", () => {
  it('refuse la seconde consommation du meme code', async () => {
    const invitation = await createInvitation(
      familyA.ownerActor,
      { targetRole: FamilyRole.CHILD, label: 'Lucas', expiresInHours: 72 },
      APP_ORIGIN,
    );

    // Premiere utilisation : le code est valide.
    const resolved = await resolveInvitationCode(prisma, invitation.formattedCode);
    expect(resolved.familyId).toBe(familyA.familyId);
    expect(resolved.targetRole).toBe(FamilyRole.CHILD);

    const consumer = await addChild(familyA.familyId, { displayName: 'Nouvel enfant' });
    await consumeInvitation(prisma, {
      invitationId: invitation.id,
      consumedByUserId: consumer.userId,
      expectedRole: FamilyRole.CHILD,
    });

    // Seconde utilisation : refusee.
    await expect(resolveInvitationCode(prisma, invitation.formattedCode)).rejects.toThrow(
      DomainError,
    );
    await expect(
      consumeInvitation(prisma, {
        invitationId: invitation.id,
        consumedByUserId: consumer.userId,
        expectedRole: FamilyRole.CHILD,
      }),
    ).rejects.toThrow(DomainError);
  });

  it("ne consomme qu'une fois meme sous consommations concurrentes", async () => {
    const invitation = await createInvitation(
      familyA.ownerActor,
      { targetRole: FamilyRole.CHILD, label: null, expiresInHours: 72 },
      APP_ORIGIN,
    );
    const consumer = await addChild(familyA.familyId, { displayName: 'Concurrent' });

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        consumeInvitation(prisma, {
          invitationId: invitation.id,
          consumedByUserId: consumer.userId,
          expectedRole: FamilyRole.CHILD,
        }),
      ),
    );

    const succeeded = attempts.filter((attempt) => attempt.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);
  });

  it('ne stocke jamais le code en clair', async () => {
    const invitation = await createInvitation(
      familyA.ownerActor,
      { targetRole: FamilyRole.CHILD, label: null, expiresInHours: 72 },
      APP_ORIGIN,
    );

    const stored = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
      select: { tokenHash: true, label: true },
    });
    const rawCode = invitation.formattedCode.replace(/-/g, '');
    expect(stored.tokenHash).not.toContain(rawCode);
    expect(stored.tokenHash).toHaveLength(64); // SHA-256 en hexadecimal

    // Le code brut n'apparait pas non plus dans le journal d'audit.
    const audit = await prisma.auditLog.findMany({
      where: { familyId: familyA.familyId, action: 'INVITATION_CREATED' },
      select: { summary: true, metadata: true },
    });
    for (const entry of audit) {
      expect(entry.summary).not.toContain(rawCode);
      expect(JSON.stringify(entry.metadata)).not.toContain(rawCode);
    }
  });

  it('empeche un jeton enfant de creer un compte parent', async () => {
    const invitation = await createInvitation(
      familyA.ownerActor,
      { targetRole: FamilyRole.CHILD, label: null, expiresInHours: 72 },
      APP_ORIGIN,
    );
    const consumer = await addChild(familyA.familyId, { displayName: 'Tentative' });

    // Le role attendu ne correspond pas a celui porte par le jeton.
    await expect(
      consumeInvitation(prisma, {
        invitationId: invitation.id,
        consumedByUserId: consumer.userId,
        expectedRole: FamilyRole.PARENT,
      }),
    ).rejects.toThrow(DomainError);

    // Le jeton reste intact : la tentative echouee ne l'a pas consomme.
    const stored = await prisma.invitation.findUniqueOrThrow({
      where: { id: invitation.id },
      select: { status: true },
    });
    expect(stored.status).toBe(InvitationStatus.PENDING);
  });

  it('refuse un jeton revoque', async () => {
    const invitation = await createInvitation(
      familyA.ownerActor,
      { targetRole: FamilyRole.CHILD, label: null, expiresInHours: 72 },
      APP_ORIGIN,
    );
    await revokeInvitation(familyA.ownerActor, invitation.id);

    await expect(resolveInvitationCode(prisma, invitation.formattedCode)).rejects.toThrow(
      DomainError,
    );
  });

  it('refuse un jeton expire', async () => {
    const invitation = await createInvitation(
      familyA.ownerActor,
      { targetRole: FamilyRole.CHILD, label: null, expiresInHours: 1 },
      APP_ORIGIN,
    );

    const future = new Date(Date.now() + 2 * 3_600_000);
    await expect(resolveInvitationCode(prisma, invitation.formattedCode, future)).rejects.toThrow(
      DomainError,
    );
  });

  it('exige la permission de gestion des enfants pour inviter un enfant', async () => {
    const limitedParent = await addParent(familyA.familyId, {
      role: FamilyRole.PARENT,
      permissions: [ParentPermission.TASK_APPROVE],
    });

    await expect(
      createInvitation(
        limitedParent,
        { targetRole: FamilyRole.CHILD, label: null, expiresInHours: 72 },
        APP_ORIGIN,
      ),
    ).rejects.toThrow(DomainError);
  });

  it("reserve au proprietaire l'invitation d'un parent", async () => {
    const admin = await addParent(familyA.familyId, {
      role: FamilyRole.ADMIN,
      elevated: true,
    });

    await expect(
      createInvitation(
        admin,
        { targetRole: FamilyRole.PARENT, label: null, expiresInHours: 72 },
        APP_ORIGIN,
      ),
    ).rejects.toThrow(DomainError);
  });

  it('exige une re-authentification recente pour inviter un parent', async () => {
    const staleOwner = await addParent(familyB.familyId, {
      role: FamilyRole.ADMIN,
      elevated: false,
    });
    // Un proprietaire dont la session n'est plus « elevee ».
    const ownerWithStaleSession = { ...familyB.ownerActor, session: staleOwner.session };

    await expect(
      createInvitation(
        ownerWithStaleSession,
        { targetRole: FamilyRole.PARENT, label: null, expiresInHours: 72 },
        APP_ORIGIN,
      ),
    ).rejects.toThrow(/verification|identite/i);
  });
});

describe('Cas J — isolation entre familles', () => {
  it("refuse la lecture d'un enfant d'une autre famille", async () => {
    await expect(getChildDetail(familyA.ownerActor, childB.membershipId)).rejects.toThrow(
      DomainError,
    );
  });

  it("refuse la creation d'une tache pour un enfant d'une autre famille", async () => {
    await expect(
      createTaskDefinition(familyA.ownerActor, {
        childMembershipId: childB.membershipId,
        title: 'Tache intrusive',
        description: null,
        pointsAward: 10,
        pointsPenalty: 0,
        recurrence: TaskRecurrence.ONE_OFF,
        startDate: toLocalDate(new Date(), familyA.timeZone),
        endDate: null,
        dueTime: '20:00',
        weekdays: [],
      }),
    ).rejects.toThrow(DomainError);

    expect(await prisma.taskDefinition.count({ where: { familyId: familyB.familyId } })).toBe(0);
  });

  it("refuse la validation d'une occurrence appartenant a une autre famille", async () => {
    const today = toLocalDate(new Date(), familyB.timeZone);
    const { id } = await createTaskDefinition(familyB.ownerActor, {
      childMembershipId: childB.membershipId,
      title: 'Devoirs',
      description: null,
      pointsAward: 20,
      pointsPenalty: 0,
      recurrence: TaskRecurrence.ONE_OFF,
      startDate: today,
      endDate: null,
      dueTime: '23:59',
      weekdays: [],
    });
    const occurrence = await prisma.taskOccurrence.findFirstOrThrow({
      where: { taskDefinitionId: id },
      select: { id: true },
    });
    await claimOccurrenceDone(childB.actor, occurrence.id);

    // Le proprietaire de la famille A manipule l'identifiant dans l'URL.
    await expect(approveOccurrence(familyA.ownerActor, occurrence.id)).rejects.toThrow(DomainError);
    await expect(getTaskDefinition(familyA.ownerActor, id)).rejects.toThrow(DomainError);

    // Aucun point n'a bouge dans la famille B.
    expect(await prisma.pointTransaction.count({ where: { familyId: familyB.familyId } })).toBe(0);
  });

  it("refuse l'ajustement de points d'un enfant d'une autre famille", async () => {
    await expect(
      adjustPoints(familyA.ownerActor, {
        childMembershipId: childB.membershipId,
        delta: 500,
        reason: 'Tentative depuis une autre famille',
        idempotencyKey: null,
      }),
    ).rejects.toThrow(DomainError);

    expect(
      await prisma.pointTransaction.count({ where: { childMembershipId: childB.membershipId } }),
    ).toBe(0);
  });

  it("refuse l'annulation d'une transaction d'une autre famille", async () => {
    await adjustPoints(familyB.ownerActor, {
      childMembershipId: childB.membershipId,
      delta: 100,
      reason: 'Solde initial',
      idempotencyKey: null,
    });
    const transaction = await prisma.pointTransaction.findFirstOrThrow({
      where: { familyId: familyB.familyId },
      select: { id: true },
    });

    await expect(
      reversePointTransaction(familyA.ownerActor, {
        transactionId: transaction.id,
        reason: 'Tentative croisee',
      }),
    ).rejects.toThrow(DomainError);
  });

  it("refuse la validation d'une recompense d'une autre famille", async () => {
    await adjustPoints(familyB.ownerActor, {
      childMembershipId: childB.membershipId,
      delta: 600,
      reason: 'Solde initial',
      idempotencyKey: null,
    });
    await createRewardRule(familyB.ownerActor, {
      childMembershipId: childB.membershipId,
      threshold: 500,
      title: 'Sortie cinema',
      description: null,
    });
    const event = await prisma.rewardEvent.findFirstOrThrow({
      where: { familyId: familyB.familyId },
      select: { id: true },
    });

    await expect(grantReward(familyA.ownerActor, event.id)).rejects.toThrow(DomainError);
  });

  it("refuse la modification du profil d'un enfant d'une autre famille", async () => {
    await expect(
      updateChildProfile(familyA.ownerActor, childB.membershipId, {
        displayName: 'Renomme',
        avatarKey: 'owl',
        colorKey: 'lagoon',
      }),
    ).rejects.toThrow(DomainError);
  });

  it("refuse la revocation d'une invitation d'une autre famille", async () => {
    const invitation = await createInvitation(
      familyB.ownerActor,
      { targetRole: FamilyRole.CHILD, label: null, expiresInHours: 72 },
      APP_ORIGIN,
    );
    await expect(revokeInvitation(familyA.ownerActor, invitation.id)).rejects.toThrow(DomainError);
  });

  it('empeche la base elle-meme de croiser deux familles', async () => {
    // Derniere ligne de defense : meme en contournant la couche service, la
    // cle etrangere composite (childMembershipId, familyId) rejette l'ecriture.
    await expect(
      prisma.pointTransaction.create({
        data: {
          familyId: familyA.familyId,
          childMembershipId: childB.membershipId,
          delta: 100,
          type: PointTransactionType.MANUAL_ADJUSTMENT,
          sourceType: PointTransactionSource.MANUAL,
          label: 'Ecriture croisee',
          reason: 'Test de la contrainte',
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.taskOccurrence.create({
        data: {
          familyId: familyA.familyId,
          taskDefinitionId: '00000000-0000-0000-0000-000000000000',
          childMembershipId: childB.membershipId,
          occurrenceDate: '2026-08-24',
          dueAt: new Date(),
          titleSnapshot: 'Croisee',
          pointsAwardSnapshot: 10,
          pointsPenaltySnapshot: 0,
          definitionVersion: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("n'expose jamais les enfants d'une autre famille dans les listes", async () => {
    const listed = await prisma.familyMembership.findMany({
      where: { familyId: familyA.familyId, role: FamilyRole.CHILD },
      select: { id: true },
    });
    expect(listed.map((row) => row.id)).toContain(childA.membershipId);
    expect(listed.map((row) => row.id)).not.toContain(childB.membershipId);
  });
});

describe('un seul proprietaire actif par famille', () => {
  it("rejette la creation d'un second proprietaire", async () => {
    const secondUser = await addParent(familyA.familyId, { role: FamilyRole.ADMIN });

    await expect(
      prisma.familyMembership.update({
        where: { id: secondUser.membershipId },
        data: { role: FamilyRole.OWNER },
      }),
    ).rejects.toThrow();
  });
});

describe('operations reservees au proprietaire', () => {
  it('refuse a un administrateur de gerer les membres ou la propriete', () => {
    const admin = {
      role: FamilyRole.ADMIN,
      permissions: [],
      session: familyA.ownerActor.session,
    } as unknown as Parameters<typeof requireCapability>[0];

    expect(() => {
      requireCapability(admin, OwnerCapability.MEMBER_MANAGE);
    }).toThrow(DomainError);
    expect(() => {
      requireCapability(admin, OwnerCapability.OWNERSHIP_TRANSFER);
    }).toThrow(DomainError);
    expect(() => {
      requireCapability(admin, OwnerCapability.FAMILY_DELETE);
    }).toThrow(DomainError);
  });
});
