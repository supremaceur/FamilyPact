import { describe, expect, it } from 'vitest';
import {
  LiftConditionType,
  RewardEventStatus,
  RewardRuleStatus,
  SanctionInstanceStatus,
  SanctionRuleStatus,
  ScoreComparator,
} from '@/generated/prisma/enums';
import {
  evaluate,
  liftConditionMet,
  liftConfigurationIssues,
  nextRewardProgress,
  progressRatio,
  resolveLiftCondition,
  rewardThresholdReached,
  sanctionThresholdReached,
  type EvaluationInput,
  type RewardRuleView,
  type SanctionInstanceView,
  type SanctionRuleView,
} from './rules-engine';

const NOW = new Date('2026-08-24T12:00:00Z');

const rewardRule = (overrides: Partial<RewardRuleView> = {}): RewardRuleView => ({
  id: 'reward-1',
  threshold: 500,
  title: 'Sortie cinema',
  status: RewardRuleStatus.ACTIVE,
  hasEvent: false,
  ...overrides,
});

const sanctionRule = (overrides: Partial<SanctionRuleView> = {}): SanctionRuleView => ({
  id: 'sanction-1',
  threshold: 100,
  comparator: ScoreComparator.LT,
  title: 'Pas de sortie',
  description: null,
  status: SanctionRuleStatus.ACTIVE,
  armed: true,
  hasOpenInstance: false,
  ...overrides,
});

const input = (overrides: Partial<EvaluationInput> = {}): EvaluationInput => ({
  score: 0,
  now: NOW,
  rewardRules: [],
  sanctionRules: [],
  activeSanctions: [],
  ...overrides,
});

describe('predicats de seuil', () => {
  it('atteint un palier de recompense a partir de la valeur exacte', () => {
    expect(rewardThresholdReached(499, 500)).toBe(false);
    expect(rewardThresholdReached(500, 500)).toBe(true);
    expect(rewardThresholdReached(501, 500)).toBe(true);
  });

  it('distingue « strictement inferieur » de « inferieur ou egal »', () => {
    expect(sanctionThresholdReached(100, 100, ScoreComparator.LT)).toBe(false);
    expect(sanctionThresholdReached(99, 100, ScoreComparator.LT)).toBe(true);
    expect(sanctionThresholdReached(100, 100, ScoreComparator.LTE)).toBe(true);
  });
});

describe('recompenses', () => {
  it('propose une recompense quand le palier est atteint', () => {
    const result = evaluate(input({ score: 510, rewardRules: [rewardRule()] }));
    expect(result.rewardProposals).toHaveLength(1);
    expect(result.rewardProposals[0]).toMatchObject({
      rewardRuleId: 'reward-1',
      threshold: 500,
      scoreAtProposal: 510,
    });
  });

  it("ne propose rien tant que le palier n'est pas atteint", () => {
    expect(evaluate(input({ score: 490, rewardRules: [rewardRule()] })).rewardProposals).toEqual(
      [],
    );
  });

  it('ne repropose jamais un palier deja traite, meme apres un aller-retour du score', () => {
    // Cas F : le score redescend a 480 puis remonte a 510.
    const rule = rewardRule({ hasEvent: true });
    expect(evaluate(input({ score: 510, rewardRules: [rule] })).rewardProposals).toEqual([]);
    expect(evaluate(input({ score: 480, rewardRules: [rule] })).rewardProposals).toEqual([]);
    expect(evaluate(input({ score: 510, rewardRules: [rule] })).rewardProposals).toEqual([]);
  });

  it('ignore les regles inactives', () => {
    const rule = rewardRule({ status: RewardRuleStatus.INACTIVE });
    expect(evaluate(input({ score: 600, rewardRules: [rule] })).rewardProposals).toEqual([]);
  });
});

describe('sanctions — logique de franchissement', () => {
  it('propose au franchissement du seuil, puis desarme la regle', () => {
    // Cas G : score 105 → 95 avec un seuil a 100.
    const armed = sanctionRule({ armed: true });
    const result = evaluate(input({ score: 95, sanctionRules: [armed] }));

    expect(result.sanctionProposals).toHaveLength(1);
    expect(result.sanctionProposals[0]).toMatchObject({
      sanctionRuleId: 'sanction-1',
      threshold: 100,
      scoreAtProposal: 95,
    });
    expect(result.armingChanges).toContainEqual({ sanctionRuleId: 'sanction-1', armed: false });
  });

  it('ne repropose pas tant que le score stagne sous le seuil', () => {
    const disarmed = sanctionRule({ armed: false });
    const result = evaluate(input({ score: 80, sanctionRules: [disarmed] }));
    expect(result.sanctionProposals).toEqual([]);
    expect(result.armingChanges).toEqual([]);
  });

  it('rearme la regle des que le score repasse au-dessus du seuil', () => {
    const disarmed = sanctionRule({ armed: false });
    const result = evaluate(input({ score: 120, sanctionRules: [disarmed] }));
    expect(result.sanctionProposals).toEqual([]);
    expect(result.armingChanges).toEqual([{ sanctionRuleId: 'sanction-1', armed: true }]);
  });

  it('autorise une nouvelle proposition apres un nouveau franchissement', () => {
    // Cycle complet : sous le seuil → proposition, au-dessus → rearmement,
    // de nouveau sous le seuil → nouvelle proposition.
    const first = evaluate(input({ score: 95, sanctionRules: [sanctionRule({ armed: true })] }));
    expect(first.sanctionProposals).toHaveLength(1);

    const rearmed = evaluate(
      input({ score: 150, sanctionRules: [sanctionRule({ armed: false })] }),
    );
    expect(rearmed.armingChanges).toEqual([{ sanctionRuleId: 'sanction-1', armed: true }]);

    const second = evaluate(input({ score: 90, sanctionRules: [sanctionRule({ armed: true })] }));
    expect(second.sanctionProposals).toHaveLength(1);
  });

  it('ne cree jamais deux episodes ouverts pour la meme regle', () => {
    const withOpenInstance = sanctionRule({ armed: true, hasOpenInstance: true });
    const result = evaluate(input({ score: 95, sanctionRules: [withOpenInstance] }));
    expect(result.sanctionProposals).toEqual([]);
    // La regle est tout de meme desarmee : sans cela, elle proposerait a la
    // fermeture de l'episode courant sans nouveau franchissement.
    expect(result.armingChanges).toEqual([{ sanctionRuleId: 'sanction-1', armed: false }]);
  });

  it('ignore les regles inactives', () => {
    const rule = sanctionRule({ status: SanctionRuleStatus.INACTIVE });
    const result = evaluate(input({ score: 0, sanctionRules: [rule] }));
    expect(result.sanctionProposals).toEqual([]);
    expect(result.armingChanges).toEqual([]);
  });
});

describe('conditions de levee', () => {
  const instance = (overrides: Partial<SanctionInstanceView> = {}): SanctionInstanceView => ({
    id: 'instance-1',
    status: SanctionInstanceStatus.ACTIVE,
    liftConditionType: LiftConditionType.SCORE,
    liftAt: null,
    liftScoreThreshold: 150,
    ...overrides,
  });

  it("n'est jamais satisfaite automatiquement en mode manuel", () => {
    expect(
      liftConditionMet(
        { liftConditionType: LiftConditionType.MANUAL, liftAt: null, liftScoreThreshold: null },
        999_999,
        NOW,
      ),
    ).toBe(false);
  });

  it('compare le score au palier de levee', () => {
    const view = {
      liftConditionType: LiftConditionType.SCORE,
      liftAt: null,
      liftScoreThreshold: 150,
    };
    expect(liftConditionMet(view, 149, NOW)).toBe(false);
    expect(liftConditionMet(view, 150, NOW)).toBe(true);
  });

  it("compare la date de levee a l'instant courant", () => {
    const view = {
      liftConditionType: LiftConditionType.DATE,
      liftAt: new Date('2026-08-30T18:00:00Z'),
      liftScoreThreshold: null,
    };
    expect(liftConditionMet(view, 0, new Date('2026-08-30T17:59:00Z'))).toBe(false);
    expect(liftConditionMet(view, 0, new Date('2026-08-30T18:00:00Z'))).toBe(true);
  });

  it('exige les deux conditions en mode ET', () => {
    const view = {
      liftConditionType: LiftConditionType.DATE_AND_SCORE,
      liftAt: new Date('2026-08-30T18:00:00Z'),
      liftScoreThreshold: 150,
    };
    expect(liftConditionMet(view, 150, new Date('2026-08-29T00:00:00Z'))).toBe(false);
    expect(liftConditionMet(view, 100, new Date('2026-08-31T00:00:00Z'))).toBe(false);
    expect(liftConditionMet(view, 150, new Date('2026-08-31T00:00:00Z'))).toBe(true);
  });

  it("se contente d'une condition en mode OU", () => {
    const view = {
      liftConditionType: LiftConditionType.DATE_OR_SCORE,
      liftAt: new Date('2026-08-30T18:00:00Z'),
      liftScoreThreshold: 150,
    };
    expect(liftConditionMet(view, 150, new Date('2026-08-29T00:00:00Z'))).toBe(true);
    expect(liftConditionMet(view, 100, new Date('2026-08-31T00:00:00Z'))).toBe(true);
    expect(liftConditionMet(view, 100, new Date('2026-08-29T00:00:00Z'))).toBe(false);
  });

  it('signale la levee possible sans jamais lever la sanction', () => {
    // Cas H : la condition atteinte ne fait que rendre la levee eligible.
    const result = evaluate(input({ score: 150, activeSanctions: [instance()] }));
    expect(result.liftEligibilities).toEqual([{ sanctionInstanceId: 'instance-1' }]);
    // Le moteur ne produit AUCUNE intention de levee : elle n'existe pas.
    expect(Object.keys(result)).not.toContain('lifts');
  });

  it("n'evalue pas une sanction deja eligible ou levee", () => {
    const eligible = instance({ status: SanctionInstanceStatus.LIFT_ELIGIBLE });
    expect(evaluate(input({ score: 200, activeSanctions: [eligible] })).liftEligibilities).toEqual(
      [],
    );
  });
});

describe('resolveLiftCondition', () => {
  const activatedAt = new Date('2026-08-24T18:00:00Z');

  it('calcule la date de levee a partir de la duree', () => {
    const resolved = resolveLiftCondition(
      {
        type: LiftConditionType.DATE,
        scoreThreshold: null,
        durationDays: 7,
        explicitLiftAt: null,
      },
      activatedAt,
    );
    expect(resolved.liftAt?.toISOString()).toBe('2026-08-31T18:00:00.000Z');
    expect(resolved.liftScoreThreshold).toBeNull();
  });

  it('privilegie une date explicite sur la duree', () => {
    const explicit = new Date('2026-08-31T20:00:00Z');
    const resolved = resolveLiftCondition(
      {
        type: LiftConditionType.DATE,
        scoreThreshold: null,
        durationDays: 30,
        explicitLiftAt: explicit,
      },
      activatedAt,
    );
    expect(resolved.liftAt).toEqual(explicit);
  });

  it('ecarte les champs sans objet pour le type choisi', () => {
    const resolved = resolveLiftCondition(
      {
        type: LiftConditionType.MANUAL,
        scoreThreshold: 300,
        durationDays: 7,
        explicitLiftAt: new Date(),
      },
      activatedAt,
    );
    expect(resolved.liftAt).toBeNull();
    expect(resolved.liftScoreThreshold).toBeNull();
  });
});

describe('liftConfigurationIssues', () => {
  it('exige une date ou une duree pour une condition temporelle', () => {
    expect(
      liftConfigurationIssues({
        type: LiftConditionType.DATE,
        scoreThreshold: null,
        durationDays: null,
        explicitLiftAt: null,
      }),
    ).toHaveLength(1);
  });

  it('exige un score pour une condition de score', () => {
    expect(
      liftConfigurationIssues({
        type: LiftConditionType.SCORE,
        scoreThreshold: null,
        durationDays: null,
        explicitLiftAt: null,
      }),
    ).toHaveLength(1);
  });

  it("n'exige rien en mode manuel", () => {
    expect(
      liftConfigurationIssues({
        type: LiftConditionType.MANUAL,
        scoreThreshold: null,
        durationDays: null,
        explicitLiftAt: null,
      }),
    ).toEqual([]);
  });
});

describe('progression vers la prochaine recompense', () => {
  it('retient le palier actif le plus bas non encore obtenu', () => {
    const progress = nextRewardProgress(375, [
      {
        id: 'a',
        title: 'Sortie cinema',
        threshold: 500,
        status: RewardRuleStatus.ACTIVE,
        eventStatus: null,
      },
      {
        id: 'b',
        title: 'Week-end',
        threshold: 1000,
        status: RewardRuleStatus.ACTIVE,
        eventStatus: null,
      },
    ]);
    expect(progress).toMatchObject({
      ruleId: 'a',
      threshold: 500,
      score: 375,
      remaining: 125,
    });
    expect(progress?.ratio).toBeCloseTo(0.75);
  });

  it('passe au palier suivant quand le precedent a ete traite', () => {
    const progress = nextRewardProgress(600, [
      {
        id: 'a',
        title: 'Sortie cinema',
        threshold: 500,
        status: RewardRuleStatus.ACTIVE,
        eventStatus: RewardEventStatus.GRANTED,
      },
      {
        id: 'b',
        title: 'Week-end',
        threshold: 1000,
        status: RewardRuleStatus.ACTIVE,
        eventStatus: null,
      },
    ]);
    expect(progress?.ruleId).toBe('b');
  });

  it("n'invente aucune recompense quand il n'en reste plus", () => {
    expect(nextRewardProgress(600, [])).toBeNull();
    expect(
      nextRewardProgress(600, [
        {
          id: 'a',
          title: 'Deja obtenue',
          threshold: 500,
          status: RewardRuleStatus.ACTIVE,
          eventStatus: RewardEventStatus.GRANTED,
        },
      ]),
    ).toBeNull();
  });

  it('ne compte jamais un reste negatif', () => {
    const progress = nextRewardProgress(700, [
      {
        id: 'a',
        title: 'Cinema',
        threshold: 500,
        status: RewardRuleStatus.ACTIVE,
        eventStatus: null,
      },
    ]);
    expect(progress?.remaining).toBe(0);
    expect(progress?.ratio).toBe(1);
  });
});

describe('progressRatio', () => {
  it('reste borne a [0, 1], meme avec un score negatif', () => {
    expect(progressRatio(-50, 500)).toBe(0);
    expect(progressRatio(250, 500)).toBe(0.5);
    expect(progressRatio(900, 500)).toBe(1);
    expect(progressRatio(10, 0)).toBe(1);
  });
});
