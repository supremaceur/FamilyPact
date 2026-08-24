import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LiftConditionType,
  RewardEventStatus,
  SanctionInstanceStatus,
  ScoreComparator,
} from '@/generated/prisma/enums';
import { prisma } from '@/server/db/prisma';
import { adjustPoints } from '@/server/services/point-adjustments';
import {
  createRewardRule,
  grantReward,
  ignoreReward,
  keepReward,
  revokeReward,
} from '@/server/services/rewards';
import {
  activateSanction,
  createSanctionRule,
  ignoreSanction,
  liftSanction,
} from '@/server/services/sanctions';
import { runEvaluateRules } from '@/server/jobs/runner';
import { listRewardRevocationSuggestions } from '@/server/queries/parent-lists';
import { getFamilyTimeline } from '@/server/queries/history';
import { addChild, createFamily } from './helpers';
import type { FamilyActor } from '@/server/auth/context';

/**
 * Cas metier E a H : proposition de recompense, absence de reproposition,
 * proposition de sanction sur franchissement, et levee soumise a validation.
 */

let family: Awaited<ReturnType<typeof createFamily>>;
let child: Awaited<ReturnType<typeof addChild>>;
let owner: FamilyActor;

beforeEach(async () => {
  family = await createFamily();
  owner = family.ownerActor;
  child = await addChild(family.familyId, { displayName: 'Lucas' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const setScore = async (target: number): Promise<void> => {
  const profile = await prisma.childProfile.findUniqueOrThrow({
    where: { membershipId: child.membershipId },
    select: { cachedBalance: true },
  });
  const delta = target - profile.cachedBalance;
  if (delta === 0) return;
  await adjustPoints(owner, {
    childMembershipId: child.membershipId,
    delta,
    reason: `Mise en situation du scenario de test (cible ${target})`,
    idempotencyKey: null,
  });
};

describe('Cas E — palier de recompense franchi', () => {
  it('cree une proposition, jamais une recompense automatique', async () => {
    await setScore(490);
    await createRewardRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 500,
      title: 'Sortie cinema',
      description: null,
    });

    // A 490 points, rien n'est propose.
    expect(
      await prisma.rewardEvent.count({ where: { childMembershipId: child.membershipId } }),
    ).toBe(0);

    await setScore(510);

    const events = await prisma.rewardEvent.findMany({
      where: { childMembershipId: child.membershipId },
      select: { id: true, status: true, scoreAtProposal: true, thresholdSnapshot: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe(RewardEventStatus.PENDING_PARENT_APPROVAL);
    expect(events[0]!.scoreAtProposal).toBe(510);

    // Le score n'a pas bouge : un palier ne consomme aucun point.
    const afterProposal = await prisma.childProfile.findUniqueOrThrow({
      where: { membershipId: child.membershipId },
      select: { cachedBalance: true },
    });
    expect(afterProposal.cachedBalance).toBe(510);

    await grantReward(owner, events[0]!.id);

    const granted = await prisma.rewardEvent.findUniqueOrThrow({
      where: { id: events[0]!.id },
      select: { status: true, decidedById: true },
    });
    expect(granted.status).toBe(RewardEventStatus.GRANTED);
    expect(granted.decidedById).toBe(owner.membershipId);

    // La validation ne consomme pas non plus de points.
    const afterGrant = await prisma.childProfile.findUniqueOrThrow({
      where: { membershipId: child.membershipId },
      select: { cachedBalance: true },
    });
    expect(afterGrant.cachedBalance).toBe(510);
  });
});

describe('Cas F — le score repasse le palier', () => {
  it('ne repropose jamais la meme recompense', async () => {
    await setScore(510);
    await createRewardRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 500,
      title: 'Sortie cinema',
      description: null,
    });

    const event = await prisma.rewardEvent.findFirstOrThrow({
      where: { childMembershipId: child.membershipId },
      select: { id: true },
    });
    await grantReward(owner, event.id);

    // Descente sous le palier, puis remontee au-dessus.
    await setScore(480);
    await setScore(510);

    expect(
      await prisma.rewardEvent.count({ where: { childMembershipId: child.membershipId } }),
    ).toBe(1);
  });

  it('ne repropose pas non plus un palier ignore', async () => {
    await setScore(510);
    await createRewardRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 500,
      title: 'Sortie cinema',
      description: null,
    });
    const event = await prisma.rewardEvent.findFirstOrThrow({
      where: { childMembershipId: child.membershipId },
      select: { id: true },
    });
    await ignoreReward(owner, event.id);

    await setScore(400);
    await setScore(600);

    expect(
      await prisma.rewardEvent.count({ where: { childMembershipId: child.membershipId } }),
    ).toBe(1);
  });
});

describe('Cas G — seuil de sanction franchi', () => {
  it('cree une proposition, sans jamais activer la sanction', async () => {
    await setScore(105);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de sortie ce week-end',
      description: null,
      liftConditionType: LiftConditionType.MANUAL,
      liftScoreThreshold: null,
      liftDurationDays: null,
    });

    // A 105 points, la regle est armee mais rien n'est propose.
    expect(
      await prisma.sanctionInstance.count({ where: { childMembershipId: child.membershipId } }),
    ).toBe(0);

    await setScore(95);

    const instances = await prisma.sanctionInstance.findMany({
      where: { childMembershipId: child.membershipId },
      select: { id: true, status: true, scoreAtProposal: true, activatedAt: true },
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]!.status).toBe(SanctionInstanceStatus.PROPOSED);
    expect(instances[0]!.scoreAtProposal).toBe(95);
    // Aucune activation automatique : c'est l'invariant central.
    expect(instances[0]!.activatedAt).toBeNull();
  });

  it('ne repropose pas tant que le score reste sous le seuil', async () => {
    await setScore(105);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de sortie',
      description: null,
      liftConditionType: LiftConditionType.MANUAL,
      liftScoreThreshold: null,
      liftDurationDays: null,
    });

    await setScore(95);
    const proposed = await prisma.sanctionInstance.findFirstOrThrow({
      where: { childMembershipId: child.membershipId },
      select: { id: true },
    });
    await ignoreSanction(owner, proposed.id);

    // Le score continue de baisser : aucune nouvelle proposition.
    await setScore(80);
    await setScore(50);
    expect(
      await prisma.sanctionInstance.count({ where: { childMembershipId: child.membershipId } }),
    ).toBe(1);
  });

  it('repropose apres un nouveau franchissement du seuil', async () => {
    await setScore(105);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de sortie',
      description: null,
      liftConditionType: LiftConditionType.MANUAL,
      liftScoreThreshold: null,
      liftDurationDays: null,
    });

    await setScore(95);
    const first = await prisma.sanctionInstance.findFirstOrThrow({
      where: { childMembershipId: child.membershipId },
      select: { id: true },
    });
    await ignoreSanction(owner, first.id);

    // Remontee au-dessus du seuil : la regle se rearme.
    await setScore(150);
    // Nouveau franchissement : une seconde proposition est legitime.
    await setScore(90);

    expect(
      await prisma.sanctionInstance.count({ where: { childMembershipId: child.membershipId } }),
    ).toBe(2);
  });

  it("n'ouvre jamais deux episodes simultanes pour la meme regle", async () => {
    await setScore(105);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de sortie',
      description: null,
      liftConditionType: LiftConditionType.MANUAL,
      liftScoreThreshold: null,
      liftDurationDays: null,
    });

    await setScore(95);
    // Le score remonte puis rechute alors que l'episode est encore ouvert.
    await setScore(150);
    await setScore(90);

    const open = await prisma.sanctionInstance.count({
      where: {
        childMembershipId: child.membershipId,
        status: {
          in: [
            SanctionInstanceStatus.PROPOSED,
            SanctionInstanceStatus.ACTIVE,
            SanctionInstanceStatus.LIFT_ELIGIBLE,
          ],
        },
      },
    });
    expect(open).toBe(1);
  });
});

describe('Cas H — condition de levee atteinte', () => {
  it('rend la levee possible, mais ne leve rien sans le parent', async () => {
    await setScore(105);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de sortie',
      description: null,
      liftConditionType: LiftConditionType.SCORE,
      liftScoreThreshold: 150,
      liftDurationDays: null,
    });

    await setScore(95);
    const proposed = await prisma.sanctionInstance.findFirstOrThrow({
      where: { childMembershipId: child.membershipId },
      select: { id: true },
    });

    await activateSanction(owner, proposed.id, {
      liftConditionType: LiftConditionType.SCORE,
      liftScoreThreshold: 150,
      liftDurationDays: null,
      liftAt: null,
    });

    let instance = await prisma.sanctionInstance.findUniqueOrThrow({
      where: { id: proposed.id },
      select: { status: true, activatedById: true, liftScoreThreshold: true },
    });
    expect(instance.status).toBe(SanctionInstanceStatus.ACTIVE);
    expect(instance.activatedById).toBe(owner.membershipId);

    // L'enfant atteint le palier de levee.
    await setScore(150);

    instance = await prisma.sanctionInstance.findUniqueOrThrow({
      where: { id: proposed.id },
      select: { status: true, activatedById: true, liftScoreThreshold: true },
    });
    // La sanction devient eligible a la levee — elle N'EST PAS levee.
    expect(instance.status).toBe(SanctionInstanceStatus.LIFT_ELIGIBLE);

    await liftSanction(owner, proposed.id);

    const lifted = await prisma.sanctionInstance.findUniqueOrThrow({
      where: { id: proposed.id },
      select: { status: true, liftedById: true, liftedAt: true, liftEligibleAt: true },
    });
    expect(lifted.status).toBe(SanctionInstanceStatus.LIFTED);
    expect(lifted.liftedById).toBe(owner.membershipId);
    expect(lifted.liftedAt).not.toBeNull();
    // L'historique conserve la date d'eligibilite ET la date de levee reelle.
    expect(lifted.liftEligibleAt).not.toBeNull();
  });

  it('reste eligible meme si le score redescend ensuite', async () => {
    await setScore(105);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de console',
      description: null,
      liftConditionType: LiftConditionType.SCORE,
      liftScoreThreshold: 150,
      liftDurationDays: null,
    });
    await setScore(95);

    const proposed = await prisma.sanctionInstance.findFirstOrThrow({
      where: { childMembershipId: child.membershipId },
      select: { id: true },
    });
    await activateSanction(owner, proposed.id, {
      liftConditionType: LiftConditionType.SCORE,
      liftScoreThreshold: 150,
      liftDurationDays: null,
      liftAt: null,
    });

    await setScore(150);
    await setScore(120);

    const instance = await prisma.sanctionInstance.findUniqueOrThrow({
      where: { id: proposed.id },
      select: { status: true },
    });
    // Le parent a ete informe : l'information ne doit pas clignoter.
    expect(instance.status).toBe(SanctionInstanceStatus.LIFT_ELIGIBLE);
  });

  it('rend eligible une levee a date grace au job planifie', async () => {
    await setScore(105);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de sortie',
      description: null,
      liftConditionType: LiftConditionType.DATE,
      liftScoreThreshold: null,
      liftDurationDays: 7,
    });
    await setScore(95);

    const proposed = await prisma.sanctionInstance.findFirstOrThrow({
      where: { childMembershipId: child.membershipId },
      select: { id: true },
    });
    await activateSanction(owner, proposed.id, {
      liftConditionType: LiftConditionType.DATE,
      liftScoreThreshold: null,
      liftDurationDays: 7,
      liftAt: null,
    });

    // Avant l'echeance, rien ne change.
    await runEvaluateRules(prisma, new Date(Date.now() + 86_400_000));
    expect(
      (
        await prisma.sanctionInstance.findUniqueOrThrow({
          where: { id: proposed.id },
          select: { status: true },
        })
      ).status,
    ).toBe(SanctionInstanceStatus.ACTIVE);

    // Apres l'echeance, la levee devient possible — sans etre appliquee.
    await runEvaluateRules(prisma, new Date(Date.now() + 8 * 86_400_000));
    expect(
      (
        await prisma.sanctionInstance.findUniqueOrThrow({
          where: { id: proposed.id },
          select: { status: true },
        })
      ).status,
    ).toBe(SanctionInstanceStatus.LIFT_ELIGIBLE);
  });

  it('laisse le parent lever avant que la condition soit atteinte', async () => {
    await setScore(105);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de sortie',
      description: null,
      liftConditionType: LiftConditionType.SCORE,
      liftScoreThreshold: 500,
      liftDurationDays: null,
    });
    await setScore(95);

    const proposed = await prisma.sanctionInstance.findFirstOrThrow({
      where: { childMembershipId: child.membershipId },
      select: { id: true },
    });
    await activateSanction(owner, proposed.id, {
      liftConditionType: LiftConditionType.SCORE,
      liftScoreThreshold: 500,
      liftDurationDays: null,
      liftAt: null,
    });

    // L'autorite parentale prime toujours sur la condition automatique.
    await liftSanction(owner, proposed.id, 'Discussion en famille');
    expect(
      (
        await prisma.sanctionInstance.findUniqueOrThrow({
          where: { id: proposed.id },
          select: { status: true },
        })
      ).status,
    ).toBe(SanctionInstanceStatus.LIFTED);
  });
});

describe('creation de regle sur une situation deja constatee', () => {
  it('propose immediatement si le seuil est deja franchi', async () => {
    await setScore(50);
    await createSanctionRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 100,
      comparator: ScoreComparator.LT,
      title: 'Pas de console',
      description: null,
      liftConditionType: LiftConditionType.MANUAL,
      liftScoreThreshold: null,
      liftDurationDays: null,
    });

    const instances = await prisma.sanctionInstance.findMany({
      where: { childMembershipId: child.membershipId },
      select: { status: true },
    });
    expect(instances).toHaveLength(1);
    expect(instances[0]!.status).toBe(SanctionInstanceStatus.PROPOSED);
  });

  it('propose immediatement une recompense dont le palier est deja atteint', async () => {
    await setScore(600);
    await createRewardRule(owner, {
      childMembershipId: child.membershipId,
      threshold: 500,
      title: 'Sortie cinema',
      description: null,
    });

    const events = await prisma.rewardEvent.findMany({
      where: { childMembershipId: child.membershipId },
      select: { status: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe(RewardEventStatus.PENDING_PARENT_APPROVAL);
  });
});

/**
 * Cas L — retrait d'une recompense qui durait.
 *
 * Le scenario de l'utilisateur, mot pour mot : l'enfant obtient « 30 min
 * d'ecran » a 80 points, redescend a 70, et le parent peut reprendre. Le
 * restaurant deja vecu, lui, ne se reprend pas.
 */
describe("Cas L — retrait d'une recompense", () => {
  const creerEtAccorder = async (options: {
    readonly threshold: number;
    readonly title: string;
    readonly revocable: boolean;
  }): Promise<string> => {
    await createRewardRule(owner, {
      childMembershipId: child.membershipId,
      threshold: options.threshold,
      title: options.title,
      description: null,
      revocable: options.revocable,
    });
    const event = await prisma.rewardEvent.findFirstOrThrow({
      where: { childMembershipId: child.membershipId, titleSnapshot: options.title },
      select: { id: true },
    });
    await grantReward(owner, event.id);
    return event.id;
  };

  it('signale le retrait quand le score repasse sous le palier, sans rien decider', async () => {
    await setScore(80);
    const eventId = await creerEtAccorder({
      threshold: 80,
      title: "30 min d'ecran",
      revocable: true,
    });

    // A 80 points, rien a revoir : le palier est encore tenu.
    expect(await listRewardRevocationSuggestions(owner)).toHaveLength(0);

    await setScore(70);

    const suggestions = await listRewardRevocationSuggestions(owner);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.id).toBe(eventId);
    expect(suggestions[0]!.score).toBe(70);

    // SIGNALER n'est pas DECIDER : la recompense est toujours detenue.
    const encoreDetenue = await prisma.rewardEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true, revokedAt: true },
    });
    expect(encoreDetenue.status).toBe(RewardEventStatus.GRANTED);
    expect(encoreDetenue.revokedAt).toBeNull();
  });

  it('retire la recompense sans toucher au score, et garde le motif', async () => {
    await setScore(80);
    const eventId = await creerEtAccorder({
      threshold: 80,
      title: "30 min d'ecran",
      revocable: true,
    });
    await setScore(70);

    const result = await revokeReward(owner, eventId, 'Chambre pas rangee de la semaine');
    expect(result.status).toBe(RewardEventStatus.REVOKED);
    expect(result.alreadyDecided).toBe(false);

    const retiree = await prisma.rewardEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true, revokedById: true, revocationReason: true },
    });
    expect(retiree.status).toBe(RewardEventStatus.REVOKED);
    expect(retiree.revokedById).toBe(owner.membershipId);
    expect(retiree.revocationReason).toBe('Chambre pas rangee de la semaine');

    // AUCUN point rendu ni retire : la recompense n'avait rien coute.
    const profile = await prisma.childProfile.findUniqueOrThrow({
      where: { membershipId: child.membershipId },
      select: { cachedBalance: true },
    });
    expect(profile.cachedBalance).toBe(70);

    // Et le retrait est lisible dans la chronologie, avec son motif.
    const timeline = await getFamilyTimeline(owner, { childMembershipId: null, cursor: null });
    const ligne = timeline.items.find(
      (item) => item.kind === 'DECISION' && item.action === 'REWARD_REVOKED',
    );
    expect(ligne).toBeDefined();
    expect(ligne!.reason).toBe('Chambre pas rangee de la semaine');
  });

  it("refuse de retirer une recompense ponctuelle : c'est fait, c'est fait", async () => {
    await setScore(200);
    const eventId = await creerEtAccorder({
      threshold: 200,
      title: 'Restaurant',
      revocable: false,
    });
    await setScore(100);

    // Elle n'est meme pas signalee.
    expect(await listRewardRevocationSuggestions(owner)).toHaveLength(0);

    await expect(revokeReward(owner, eventId, 'Betise')).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const intacte = await prisma.rewardEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true },
    });
    expect(intacte.status).toBe(RewardEventStatus.GRANTED);
  });

  it('cesse de proposer le retrait une fois que le parent a choisi de laisser', async () => {
    await setScore(80);
    const eventId = await creerEtAccorder({
      threshold: 80,
      title: "30 min d'ecran",
      revocable: true,
    });
    await setScore(70);
    expect(await listRewardRevocationSuggestions(owner)).toHaveLength(1);

    await keepReward(owner, eventId, null);

    expect(await listRewardRevocationSuggestions(owner)).toHaveLength(0);

    // « Laisser » ne change rien a la recompense elle-meme.
    const laissee = await prisma.rewardEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true, keptAt: true },
    });
    expect(laissee.status).toBe(RewardEventStatus.GRANTED);
    expect(laissee.keptAt).not.toBeNull();

    // Le retrait manuel reste possible ensuite.
    await revokeReward(owner, eventId, 'Finalement non');
    const retiree = await prisma.rewardEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { status: true },
    });
    expect(retiree.status).toBe(RewardEventStatus.REVOKED);
  });

  it("exige un motif, et ne retire qu'une fois", async () => {
    await setScore(80);
    const eventId = await creerEtAccorder({
      threshold: 80,
      title: "30 min d'ecran",
      revocable: true,
    });

    await expect(revokeReward(owner, eventId, '   ')).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    await revokeReward(owner, eventId, 'Premiere fois');
    // Deuxieme appel : la recompense n'est plus GRANTED, donc rien ne bouge.
    const second = await revokeReward(owner, eventId, 'Deuxieme fois');
    expect(second.alreadyDecided).toBe(true);

    const retiree = await prisma.rewardEvent.findUniqueOrThrow({
      where: { id: eventId },
      select: { revocationReason: true },
    });
    expect(retiree.revocationReason).toBe('Premiere fois');
  });
});
