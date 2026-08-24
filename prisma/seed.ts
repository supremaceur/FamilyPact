/**
 * Seed de DEVELOPPEMENT.
 *
 * Cree une famille de demonstration complete afin de pouvoir parcourir
 * l'application immediatement : deux parents, deux enfants, des taches, un
 * historique de points, des paliers de recompense et une sanction active.
 *
 * SECURITE — ce script REFUSE de s'executer en production, et refuse aussi de
 * s'executer si `ALLOW_DEV_SEED` n'est pas explicitement active. Les mots de
 * passe sont volontairement affiches en clair a la console : ce sont des
 * identifiants de demonstration, ils n'ont aucune valeur et ne doivent jamais
 * exister ailleurs qu'en local.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  FamilyRole,
  LiftConditionType,
  MembershipStatus,
  PointTransactionSource,
  PointTransactionType,
  RewardEventStatus,
  SanctionInstanceStatus,
  ScoreComparator,
  TaskOccurrenceState,
  TaskRecurrence,
  UserKind,
} from '../src/generated/prisma/enums';
import { hashPassword } from '../src/server/crypto/hashing';
import { generateTotpSecret } from '../src/server/auth/totp';
import { DEFAULT_PARENT_PERMISSIONS } from '../src/domain/permissions';
import { localDateTimeToInstant, toLocalDate, addLocalDays } from '../src/domain/time';

const DEMO_PASSWORD_PARENT = 'demonstration-familipact';
const DEMO_PASSWORD_CHILD = 'demo-enfant';
const TIME_ZONE = 'Europe/Paris';

const assertSafeEnvironment = (): void => {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'Le seed de demonstration est interdit en production : il cree des comptes a mots de passe connus.',
    );
  }
  const allowed = process.env['ALLOW_DEV_SEED'];
  if (allowed !== '1' && allowed !== 'true') {
    throw new Error(
      'Positionnez ALLOW_DEV_SEED=1 pour autoriser le seed de demonstration (voir .env.example).',
    );
  }
};

const main = async (): Promise<void> => {
  assertSafeEnvironment();

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined) throw new Error('DATABASE_URL est obligatoire.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // Le seed est rejouable : la famille de demonstration precedente est effacee.
    const existing = await prisma.family.findFirst({
      where: { name: 'Famille Durand (demonstration)' },
      select: { id: true, memberships: { select: { userId: true } } },
    });
    if (existing !== null) {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL familipact.purge = 'on'`);
        await tx.family.delete({ where: { id: existing.id } });
      });
      await prisma.user.deleteMany({
        where: { id: { in: existing.memberships.map((member) => member.userId) } },
      });
    }

    const [parentHash, childHash] = await Promise.all([
      hashPassword(DEMO_PASSWORD_PARENT),
      hashPassword(DEMO_PASSWORD_CHILD),
    ]);

    const family = await prisma.family.create({
      data: { name: 'Famille Durand (demonstration)', timeZone: TIME_ZONE },
      select: { id: true },
    });

    /** Cree un compte adulte avec un TOTP deja confirme, pour pouvoir se connecter. */
    const createParent = async (
      email: string,
      displayName: string,
      role: FamilyRole,
    ): Promise<{ userId: string; membershipId: string; totpSecret: string }> => {
      const user = await prisma.user.create({
        data: { kind: UserKind.ADULT, email, displayName, passwordHash: parentHash },
        select: { id: true },
      });

      const generated = generateTotpSecret(user.id, email);
      await prisma.totpCredential.create({
        data: {
          userId: user.id,
          secretCiphertext: generated.sealed.ciphertext,
          secretNonce: generated.sealed.nonce,
          secretAuthTag: generated.sealed.authTag,
          confirmedAt: new Date(),
        },
      });

      const membership = await prisma.familyMembership.create({
        data: {
          familyId: family.id,
          userId: user.id,
          role,
          status: MembershipStatus.ACTIVE,
          ...(role === FamilyRole.PARENT
            ? {
                permissions: {
                  createMany: {
                    data: DEFAULT_PARENT_PERMISSIONS.map((permission) => ({ permission })),
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });

      return { userId: user.id, membershipId: membership.id, totpSecret: generated.base32 };
    };

    const marie = await createParent('marie@demo.familipact.test', 'Marie', FamilyRole.OWNER);
    const paul = await createParent('paul@demo.familipact.test', 'Paul', FamilyRole.PARENT);

    const createChild = async (
      loginId: string,
      displayName: string,
      avatarKey: string,
      colorKey: string,
    ): Promise<{ userId: string; membershipId: string }> => {
      const user = await prisma.user.create({
        data: { kind: UserKind.CHILD, loginId, displayName, passwordHash: childHash },
        select: { id: true },
      });
      const membership = await prisma.familyMembership.create({
        data: {
          familyId: family.id,
          userId: user.id,
          role: FamilyRole.CHILD,
          status: MembershipStatus.ACTIVE,
          childProfile: { create: { familyId: family.id, avatarKey, colorKey } },
        },
        select: { id: true },
      });
      return { userId: user.id, membershipId: membership.id };
    };

    const lucas = await createChild('lucas.demo', 'Lucas', 'fox', 'sage');
    const emma = await createChild('emma.demo', 'Emma', 'owl', 'lilac');

    const today = toLocalDate(new Date(), TIME_ZONE);

    /** Ecrit une transaction ET met a jour le solde cache, comme le fait le service. */
    const credit = async (
      childMembershipId: string,
      delta: number,
      label: string,
      type: PointTransactionType,
      sourceType: PointTransactionSource,
      options: { sourceId?: string; reason?: string; approvedBy?: string; daysAgo?: number } = {},
    ): Promise<void> => {
      const effectiveAt = new Date(Date.now() - (options.daysAgo ?? 0) * 86_400_000);
      await prisma.$transaction(async (tx) => {
        await tx.pointTransaction.create({
          data: {
            familyId: family.id,
            childMembershipId,
            delta,
            type,
            sourceType,
            sourceId: options.sourceId ?? null,
            label,
            reason: options.reason ?? null,
            approvedById: options.approvedBy ?? marie.membershipId,
            effectiveAt,
            createdAt: effectiveAt,
          },
        });
        await tx.childProfile.update({
          where: { membershipId: childMembershipId },
          data: {
            cachedBalance: { increment: delta },
            transactionCount: { increment: 1 },
            balanceUpdatedAt: effectiveAt,
          },
        });
      });
    };

    // --- Historique de points ------------------------------------------------
    await credit(
      lucas.membershipId,
      300,
      'Report du mois precedent',
      PointTransactionType.MANUAL_ADJUSTMENT,
      PointTransactionSource.MANUAL,
      { reason: 'Solde initial de demonstration', daysAgo: 30 },
    );
    await credit(
      lucas.membershipId,
      20,
      'Devoirs',
      PointTransactionType.TASK_APPROVED,
      PointTransactionSource.TASK_OCCURRENCE,
      { sourceId: 'demo-lucas-1', daysAgo: 5 },
    );
    await credit(
      lucas.membershipId,
      20,
      'Devoirs',
      PointTransactionType.TASK_APPROVED,
      PointTransactionSource.TASK_OCCURRENCE,
      { sourceId: 'demo-lucas-2', daysAgo: 4 },
    );
    await credit(
      lucas.membershipId,
      25,
      'Vaisselle du week-end',
      PointTransactionType.TASK_APPROVED,
      PointTransactionSource.TASK_OCCURRENCE,
      { sourceId: 'demo-lucas-3', approvedBy: paul.membershipId, daysAgo: 3 },
    );
    await credit(
      lucas.membershipId,
      -10,
      'Ranger la chambre — non realisee',
      PointTransactionType.TASK_MISSED,
      PointTransactionSource.TASK_OCCURRENCE,
      { sourceId: 'demo-lucas-4', approvedBy: paul.membershipId, daysAgo: 2 },
    );
    await credit(
      lucas.membershipId,
      20,
      'Devoirs',
      PointTransactionType.TASK_APPROVED,
      PointTransactionSource.TASK_OCCURRENCE,
      { sourceId: 'demo-lucas-5', daysAgo: 1 },
    );

    await credit(
      emma.membershipId,
      60,
      'Report du mois precedent',
      PointTransactionType.MANUAL_ADJUSTMENT,
      PointTransactionSource.MANUAL,
      { reason: 'Solde initial de demonstration', daysAgo: 30 },
    );
    await credit(
      emma.membershipId,
      15,
      'Mettre la table',
      PointTransactionType.TASK_APPROVED,
      PointTransactionSource.TASK_OCCURRENCE,
      { sourceId: 'demo-emma-1', daysAgo: 4 },
    );
    await credit(
      emma.membershipId,
      -10,
      'Devoirs — non realises',
      PointTransactionType.TASK_MISSED,
      PointTransactionSource.TASK_OCCURRENCE,
      { sourceId: 'demo-emma-2', daysAgo: 2 },
    );

    // --- Taches ---------------------------------------------------------------
    const createTask = async (
      childMembershipId: string,
      title: string,
      pointsAward: number,
      pointsPenalty: number,
      recurrence: TaskRecurrence,
      weekdays: number[],
      dueTime: string,
    ): Promise<string> => {
      const definition = await prisma.taskDefinition.create({
        data: {
          familyId: family.id,
          childMembershipId,
          title,
          pointsAward,
          pointsPenalty,
          recurrence,
          startDate: today,
          dueTime,
          weekdays,
          createdById: marie.membershipId,
        },
        select: { id: true },
      });

      // Occurrences du jour et des deux jours suivants.
      for (let offset = 0; offset < 3; offset += 1) {
        const date = addLocalDays(today, offset);
        const isoWeekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
        if (recurrence === TaskRecurrence.WEEKLY_DAYS && !weekdays.includes(isoWeekday)) continue;
        await prisma.taskOccurrence.create({
          data: {
            familyId: family.id,
            taskDefinitionId: definition.id,
            childMembershipId,
            occurrenceDate: date,
            dueAt: localDateTimeToInstant(date, dueTime, TIME_ZONE),
            titleSnapshot: title,
            pointsAwardSnapshot: pointsAward,
            pointsPenaltySnapshot: pointsPenalty,
            definitionVersion: 1,
          },
        });
      }
      return definition.id;
    };

    await createTask(
      lucas.membershipId,
      'Devoirs',
      20,
      10,
      TaskRecurrence.WEEKLY_DAYS,
      [1, 2, 3, 4, 5],
      '18:30',
    );
    await createTask(
      lucas.membershipId,
      'Ranger la chambre',
      10,
      10,
      TaskRecurrence.DAILY,
      [],
      '20:00',
    );
    await createTask(
      emma.membershipId,
      'Mettre la table',
      15,
      5,
      TaskRecurrence.DAILY,
      [],
      '19:00',
    );

    // Une tache deja declaree terminee, en attente de validation parentale.
    const pending = await prisma.taskOccurrence.findFirstOrThrow({
      where: { childMembershipId: lucas.membershipId, occurrenceDate: today },
      select: { id: true },
    });
    await prisma.taskOccurrence.update({
      where: { id: pending.id },
      data: {
        state: TaskOccurrenceState.CLAIMED_DONE,
        claimedAt: new Date(),
        claimedByUserId: lucas.userId,
      },
    });

    // Une echeance depassee, en attente de decision parentale.
    const missedTask = await createTask(
      emma.membershipId,
      'Sortir les poubelles',
      10,
      10,
      TaskRecurrence.DAILY,
      [],
      '08:00',
    );
    const missedOccurrence = await prisma.taskOccurrence.findFirstOrThrow({
      where: { taskDefinitionId: missedTask, occurrenceDate: today },
      select: { id: true },
    });
    await prisma.taskOccurrence.update({
      where: { id: missedOccurrence.id },
      data: {
        state: TaskOccurrenceState.MISSED_PENDING_REVIEW,
        dueAt: new Date(Date.now() - 3_600_000),
        missedDetectedAt: new Date(),
      },
    });

    // --- Recompenses ----------------------------------------------------------
    // Palier deja obtenu, volontairement bas : il montre l'historique tout en
    // laissant « Sortie cinema » comme prochaine recompense de Lucas.
    const dessert = await prisma.rewardRule.create({
      data: {
        familyId: family.id,
        childMembershipId: lucas.membershipId,
        threshold: 200,
        title: 'Choisir le dessert du week-end',
        createdById: marie.membershipId,
      },
      select: { id: true },
    });

    await prisma.rewardRule.create({
      data: {
        familyId: family.id,
        childMembershipId: lucas.membershipId,
        threshold: 500,
        title: 'Sortie cinema',
        description: 'Un film au choix, popcorn compris.',
        createdById: marie.membershipId,
      },
    });
    await prisma.rewardRule.create({
      data: {
        familyId: family.id,
        childMembershipId: lucas.membershipId,
        threshold: 1_000,
        title: 'Week-end chez les cousins',
        createdById: marie.membershipId,
      },
    });
    await prisma.rewardRule.create({
      data: {
        familyId: family.id,
        childMembershipId: emma.membershipId,
        threshold: 200,
        title: 'Choisir le repas du dimanche',
        createdById: marie.membershipId,
      },
    });

    // Un palier deja obtenu, pour montrer l'historique.
    await prisma.rewardEvent.create({
      data: {
        familyId: family.id,
        rewardRuleId: dessert.id,
        childMembershipId: lucas.membershipId,
        status: RewardEventStatus.GRANTED,
        titleSnapshot: 'Choisir le dessert du week-end',
        thresholdSnapshot: 200,
        scoreAtProposal: 205,
        proposedAt: new Date(Date.now() - 10 * 86_400_000),
        decidedAt: new Date(Date.now() - 9 * 86_400_000),
        decidedById: marie.membershipId,
      },
    });

    // Une recompense QUI DURE, obtenue puis passee sous le palier : le score
    // d'Emma est redescendu a 65 alors qu'il fallait 100. L'ecran parent la
    // signale donc « a revoir » — et laisser reste une reponse normale.
    const ecran = await prisma.rewardRule.create({
      data: {
        familyId: family.id,
        childMembershipId: emma.membershipId,
        threshold: 100,
        title: "30 min d'ecran en plus",
        description: 'Chaque soir, tant que le score se tient au-dessus de 100.',
        revocable: true,
        createdById: marie.membershipId,
      },
      select: { id: true },
    });
    await prisma.rewardEvent.create({
      data: {
        familyId: family.id,
        rewardRuleId: ecran.id,
        childMembershipId: emma.membershipId,
        status: RewardEventStatus.GRANTED,
        titleSnapshot: "30 min d'ecran en plus",
        thresholdSnapshot: 100,
        scoreAtProposal: 110,
        proposedAt: new Date(Date.now() - 6 * 86_400_000),
        decidedAt: new Date(Date.now() - 6 * 86_400_000),
        decidedById: marie.membershipId,
      },
    });

    // --- Sanctions ------------------------------------------------------------
    const sanctionRule = await prisma.sanctionRule.create({
      data: {
        familyId: family.id,
        childMembershipId: emma.membershipId,
        threshold: 100,
        comparator: ScoreComparator.LT,
        title: 'Pas de sortie ce week-end',
        description: 'A rediscuter en famille dimanche soir.',
        liftConditionType: LiftConditionType.SCORE,
        liftScoreThreshold: 120,
        armed: false,
        createdById: marie.membershipId,
      },
      select: { id: true },
    });

    // Une sanction active, avec une condition de levee a base de score.
    await prisma.sanctionInstance.create({
      data: {
        familyId: family.id,
        sanctionRuleId: sanctionRule.id,
        childMembershipId: emma.membershipId,
        status: SanctionInstanceStatus.ACTIVE,
        titleSnapshot: 'Pas de sortie ce week-end',
        descriptionSnapshot: 'A rediscuter en famille dimanche soir.',
        thresholdSnapshot: 100,
        comparatorSnapshot: ScoreComparator.LT,
        scoreAtProposal: 65,
        proposedAt: new Date(Date.now() - 2 * 86_400_000),
        activatedAt: new Date(Date.now() - 2 * 86_400_000),
        activatedById: marie.membershipId,
        liftConditionType: LiftConditionType.SCORE,
        liftScoreThreshold: 120,
      },
    });

    const balances = await prisma.childProfile.findMany({
      select: {
        cachedBalance: true,
        membership: { select: { user: { select: { displayName: true } } } },
      },
    });

    console.log('');
    console.log('  Famille de demonstration creee.');
    console.log('  ----------------------------------------------------------------');
    console.log('  DONNEES DE DEMONSTRATION UNIQUEMENT — ne jamais utiliser ailleurs.');
    console.log('');
    console.log('  Parents (mot de passe : ' + DEMO_PASSWORD_PARENT + ')');
    console.log('    marie@demo.familipact.test   proprietaire');
    console.log('      secret TOTP : ' + marie.totpSecret);
    console.log('    paul@demo.familipact.test    parent (permissions par defaut)');
    console.log('      secret TOTP : ' + paul.totpSecret);
    console.log('');
    console.log('  Enfants (mot de passe : ' + DEMO_PASSWORD_CHILD + ')');
    console.log('    lucas.demo');
    console.log('    emma.demo');
    console.log('');
    for (const balance of balances) {
      console.log(
        `  Score ${balance.membership.user.displayName} : ${balance.cachedBalance} points`,
      );
    }
    console.log('');
    console.log("  Ajoutez les secrets TOTP a votre application d'authentification,");
    console.log('  ou saisissez-les manuellement (type : base32, SHA1, 6 chiffres, 30 s).');
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
