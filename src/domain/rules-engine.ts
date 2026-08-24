/**
 * Moteur de regles — deterministe, pur, sans effet de bord.
 *
 * Il repond a une seule question : « compte tenu du score et de l'etat courant,
 * quelles PROPOSITIONS faut-il soumettre au parent ? »
 *
 * Il ne decide jamais. Il ne cree ni recompense obtenue, ni sanction active :
 * il produit des intentions que la couche service materialise en propositions
 * en attente de validation parentale.
 *
 * Separation volontaire entre :
 *   - condition detectee  → ce module ;
 *   - decision parentale  → src/server/services/*.
 */

import {
  LiftConditionType,
  RewardEventStatus,
  RewardRuleStatus,
  SanctionInstanceStatus,
  SanctionRuleStatus,
  ScoreComparator,
} from '@/generated/prisma/enums';

export {
  LiftConditionType,
  RewardEventStatus,
  RewardRuleStatus,
  SanctionInstanceStatus,
  SanctionRuleStatus,
  ScoreComparator,
};

// ---------------------------------------------------------------------------
// Entrees du moteur
// ---------------------------------------------------------------------------

export interface RewardRuleView {
  readonly id: string;
  readonly threshold: number;
  readonly title: string;
  readonly status: RewardRuleStatus;
  /** Un evenement existe deja pour cette regle (quel que soit son statut). */
  readonly hasEvent: boolean;
}

export interface SanctionRuleView {
  readonly id: string;
  readonly threshold: number;
  readonly comparator: ScoreComparator;
  readonly title: string;
  readonly description: string | null;
  readonly status: SanctionRuleStatus;
  /** Voir `armed` dans le schema : detection par franchissement, pas par etat. */
  readonly armed: boolean;
  /** Un episode non terminal existe deja pour cette regle. */
  readonly hasOpenInstance: boolean;
}

export interface SanctionInstanceView {
  readonly id: string;
  readonly status: SanctionInstanceStatus;
  readonly liftConditionType: LiftConditionType;
  readonly liftAt: Date | null;
  readonly liftScoreThreshold: number | null;
}

export interface EvaluationInput {
  readonly score: number;
  readonly now: Date;
  readonly rewardRules: readonly RewardRuleView[];
  readonly sanctionRules: readonly SanctionRuleView[];
  readonly activeSanctions: readonly SanctionInstanceView[];
}

// ---------------------------------------------------------------------------
// Sorties du moteur
// ---------------------------------------------------------------------------

export interface RewardProposalIntent {
  readonly rewardRuleId: string;
  readonly title: string;
  readonly threshold: number;
  readonly scoreAtProposal: number;
}

export interface SanctionProposalIntent {
  readonly sanctionRuleId: string;
  readonly title: string;
  readonly description: string | null;
  readonly threshold: number;
  readonly comparator: ScoreComparator;
  readonly scoreAtProposal: number;
}

export interface SanctionArmingChange {
  readonly sanctionRuleId: string;
  readonly armed: boolean;
}

export interface SanctionLiftEligibilityIntent {
  readonly sanctionInstanceId: string;
}

export interface EvaluationResult {
  readonly rewardProposals: readonly RewardProposalIntent[];
  readonly sanctionProposals: readonly SanctionProposalIntent[];
  readonly armingChanges: readonly SanctionArmingChange[];
  readonly liftEligibilities: readonly SanctionLiftEligibilityIntent[];
}

// ---------------------------------------------------------------------------
// Predicats
// ---------------------------------------------------------------------------

/** Le palier de recompense est-il atteint ? */
export const rewardThresholdReached = (score: number, threshold: number): boolean =>
  score >= threshold;

/** Le seuil de sanction est-il franchi ? */
export const sanctionThresholdReached = (
  score: number,
  threshold: number,
  comparator: ScoreComparator,
): boolean => (comparator === ScoreComparator.LTE ? score <= threshold : score < threshold);

/**
 * La condition de levee d'une sanction active est-elle satisfaite ?
 *
 * MANUAL n'est jamais satisfaite automatiquement : seul le parent leve.
 */
export const liftConditionMet = (
  instance: Pick<SanctionInstanceView, 'liftConditionType' | 'liftAt' | 'liftScoreThreshold'>,
  score: number,
  now: Date,
): boolean => {
  const dateMet = instance.liftAt !== null && now.getTime() >= instance.liftAt.getTime();
  const scoreMet = instance.liftScoreThreshold !== null && score >= instance.liftScoreThreshold;

  switch (instance.liftConditionType) {
    case LiftConditionType.MANUAL:
      return false;
    case LiftConditionType.DATE:
      return dateMet;
    case LiftConditionType.SCORE:
      return scoreMet;
    case LiftConditionType.DATE_AND_SCORE:
      return dateMet && scoreMet;
    case LiftConditionType.DATE_OR_SCORE:
      return dateMet || scoreMet;
  }
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evalue l'ensemble des regles d'un enfant.
 *
 * Recompenses — un palier n'est propose qu'une seule fois par regle et par
 * enfant : `hasEvent` couvre aussi bien la recompense deja obtenue que celle
 * deja ignoree. Le score peut donc repasser plusieurs fois le seuil sans creer
 * de doublon.
 *
 * Sanctions — la detection porte sur le FRANCHISSEMENT du seuil, pas sur
 * l'etat. Une regle « armee » (score au-dessus du seuil) produit une proposition
 * lors du passage sous le seuil, puis se desarme. Elle ne se rearme qu'une fois
 * le score revenu au-dessus du seuil. Tant que le score stagne sous le seuil,
 * plus rien n'est propose.
 *
 * Levees — une sanction active dont la condition est atteinte devient eligible
 * a la levee. Elle ne se leve JAMAIS seule : c'est le parent qui tranche. Une
 * fois eligible, elle le reste, meme si le score redescend : le parent a ete
 * informe, l'information ne doit pas clignoter.
 */
export const evaluate = (input: EvaluationInput): EvaluationResult => {
  const rewardProposals: RewardProposalIntent[] = [];
  const sanctionProposals: SanctionProposalIntent[] = [];
  const armingChanges: SanctionArmingChange[] = [];
  const liftEligibilities: SanctionLiftEligibilityIntent[] = [];

  for (const rule of input.rewardRules) {
    if (rule.status !== RewardRuleStatus.ACTIVE) continue;
    if (rule.hasEvent) continue;
    if (!rewardThresholdReached(input.score, rule.threshold)) continue;

    rewardProposals.push({
      rewardRuleId: rule.id,
      title: rule.title,
      threshold: rule.threshold,
      scoreAtProposal: input.score,
    });
  }

  for (const rule of input.sanctionRules) {
    if (rule.status !== SanctionRuleStatus.ACTIVE) continue;

    const belowThreshold = sanctionThresholdReached(input.score, rule.threshold, rule.comparator);

    if (!belowThreshold) {
      // Le score est repasse au-dessus du seuil : la regle se rearme.
      if (!rule.armed) armingChanges.push({ sanctionRuleId: rule.id, armed: true });
      continue;
    }

    if (!rule.armed) continue;
    // Desarmement systematique des le franchissement, meme si un episode ouvert
    // empeche de proposer : sinon la regle re-proposerait a la fermeture de cet
    // episode sans nouveau franchissement.
    armingChanges.push({ sanctionRuleId: rule.id, armed: false });
    if (rule.hasOpenInstance) continue;

    sanctionProposals.push({
      sanctionRuleId: rule.id,
      title: rule.title,
      description: rule.description,
      threshold: rule.threshold,
      comparator: rule.comparator,
      scoreAtProposal: input.score,
    });
  }

  for (const instance of input.activeSanctions) {
    if (instance.status !== SanctionInstanceStatus.ACTIVE) continue;
    if (!liftConditionMet(instance, input.score, input.now)) continue;
    liftEligibilities.push({ sanctionInstanceId: instance.id });
  }

  return { rewardProposals, sanctionProposals, armingChanges, liftEligibilities };
};

// ---------------------------------------------------------------------------
// Progression vers la prochaine recompense
// ---------------------------------------------------------------------------

export interface RewardProgress {
  readonly ruleId: string;
  readonly title: string;
  readonly threshold: number;
  readonly score: number;
  readonly remaining: number;
  /** Ratio borne a [0, 1] pour la barre de progression. */
  readonly ratio: number;
}

export interface NextRewardCandidate {
  readonly id: string;
  readonly title: string;
  readonly threshold: number;
  readonly status: RewardRuleStatus;
  readonly eventStatus: RewardEventStatus | null;
}

/**
 * Prochaine recompense pertinente : le palier actif le plus bas qui n'a pas
 * encore donne lieu a un evenement.
 *
 * Retourne `null` si la famille n'a defini aucun palier restant — l'interface
 * affiche alors un etat vide honnete, sans inventer d'objectif.
 */
export const nextRewardProgress = (
  score: number,
  rules: readonly NextRewardCandidate[],
): RewardProgress | null => {
  const candidates = rules
    .filter((rule) => rule.status === RewardRuleStatus.ACTIVE && rule.eventStatus === null)
    .slice()
    .sort((left, right) => left.threshold - right.threshold);

  const next = candidates[0];
  if (next === undefined) return null;

  return {
    ruleId: next.id,
    title: next.title,
    threshold: next.threshold,
    score,
    remaining: Math.max(0, next.threshold - score),
    ratio: progressRatio(score, next.threshold),
  };
};

// ---------------------------------------------------------------------------
// Retrait d'une recompense qui durait
// ---------------------------------------------------------------------------

export interface GrantedRewardView {
  readonly rewardEventId: string;
  readonly title: string;
  readonly threshold: number;
  /** La regle declare-t-elle une recompense qui dure ? */
  readonly revocable: boolean;
  /** Un parent a deja choisi de la laisser malgre un score redescendu. */
  readonly kept: boolean;
}

/**
 * Le score est-il redescendu sous le palier qui avait donne la recompense ?
 *
 * Strictement inferieur, par symetrie exacte avec `rewardThresholdReached`
 * (`score >= threshold`) : au score du palier pile, la recompense reste due.
 */
export const rewardBelowThreshold = (score: number, threshold: number): boolean =>
  score < threshold;

/**
 * Recompenses dont le retrait merite d'etre SIGNALE au parent.
 *
 * Ne decide rien, et ne cree aucune ligne : la suggestion est recalculee a
 * chaque affichage a partir du score courant. Elle disparait donc d'elle-meme
 * si le score remonte, sans traitement de rattrapage ni risque de derive entre
 * une proposition figee et la realite.
 *
 * Trois conditions cumulatives :
 *   - la famille a declare la recompense comme durable (`revocable`) — un
 *     restaurant deja vecu ne se reprend pas ;
 *   - aucun parent n'a deja repondu « laisser » ;
 *   - le score est repasse sous le palier.
 */
export const suggestRewardRevocations = (
  score: number,
  granted: readonly GrantedRewardView[],
): readonly GrantedRewardView[] =>
  granted.filter(
    (reward) => reward.revocable && !reward.kept && rewardBelowThreshold(score, reward.threshold),
  );

/**
 * Ratio de progression, borne a [0, 1].
 *
 * Le point de depart est 0 point : la barre represente « ou j'en suis par
 * rapport au palier », pas une mecanique de jeu.
 */
export const progressRatio = (score: number, threshold: number): number => {
  if (threshold <= 0) return 1;
  if (score <= 0) return 0;
  return Math.min(1, score / threshold);
};

// ---------------------------------------------------------------------------
// Conditions de levee — resolution a l'activation
// ---------------------------------------------------------------------------

export interface LiftConfiguration {
  readonly type: LiftConditionType;
  readonly scoreThreshold: number | null;
  readonly durationDays: number | null;
  /** Instant de levee fixe, prioritaire sur `durationDays` s'il est fourni. */
  readonly explicitLiftAt: Date | null;
}

export interface ResolvedLiftCondition {
  readonly liftConditionType: LiftConditionType;
  readonly liftAt: Date | null;
  readonly liftScoreThreshold: number | null;
}

const requiresDate = (type: LiftConditionType): boolean =>
  type === LiftConditionType.DATE ||
  type === LiftConditionType.DATE_AND_SCORE ||
  type === LiftConditionType.DATE_OR_SCORE;

const requiresScore = (type: LiftConditionType): boolean =>
  type === LiftConditionType.SCORE ||
  type === LiftConditionType.DATE_AND_SCORE ||
  type === LiftConditionType.DATE_OR_SCORE;

/**
 * Fige la condition de levee au moment ou le parent active la sanction.
 *
 * C'est l'instance, et non la regle, qui fait foi ensuite : modifier la regle
 * plus tard ne change pas une sanction deja en cours.
 */
export const resolveLiftCondition = (
  configuration: LiftConfiguration,
  activatedAt: Date,
): ResolvedLiftCondition => {
  const liftAt = requiresDate(configuration.type)
    ? (configuration.explicitLiftAt ??
      (configuration.durationDays !== null
        ? new Date(activatedAt.getTime() + configuration.durationDays * 86_400_000)
        : null))
    : null;

  const liftScoreThreshold = requiresScore(configuration.type)
    ? configuration.scoreThreshold
    : null;

  return {
    liftConditionType: configuration.type,
    liftAt,
    liftScoreThreshold,
  };
};

/** Valide qu'une configuration de levee est exploitable. */
export const liftConfigurationIssues = (configuration: LiftConfiguration): readonly string[] => {
  const issues: string[] = [];
  if (requiresDate(configuration.type)) {
    if (configuration.explicitLiftAt === null && configuration.durationDays === null) {
      issues.push('Indiquez une date de fin ou une duree.');
    }
    if (configuration.durationDays !== null && configuration.durationDays <= 0) {
      issues.push("La duree doit etre d'au moins un jour.");
    }
  }
  if (requiresScore(configuration.type) && configuration.scoreThreshold === null) {
    issues.push('Indiquez le score a atteindre.');
  }
  return issues;
};

export const LIFT_CONDITION_LABELS: Readonly<Record<LiftConditionType, string>> = {
  MANUAL: 'Levee manuelle',
  DATE: "Jusqu'a une date",
  SCORE: "Jusqu'a un score",
  DATE_AND_SCORE: 'Date ET score',
  DATE_OR_SCORE: 'Date OU score',
};

export const SANCTION_STATUS_LABELS: Readonly<Record<SanctionInstanceStatus, string>> = {
  PROPOSED: 'Proposee',
  IGNORED: 'Ignoree',
  ACTIVE: 'Active',
  LIFT_ELIGIBLE: 'Levee possible',
  LIFTED: 'Levee',
  CANCELLED: 'Annulee',
};
