/**
 * Contrats de lecture partages entre le serveur et l'interface.
 *
 * Ces types decrivent ce que l'interface RECOIT, pas ce que la base contient.
 * Les placer hors de `src/server` permet aux composants de les importer sans
 * pouvoir atteindre la base : la frontiere est verifiee par le lint, pas
 * seulement par convention.
 */

export interface RewardProgressView {
  readonly ruleId: string;
  readonly title: string;
  readonly threshold: number;
  readonly score: number;
  readonly remaining: number;
  readonly ratio: number;
}

export interface ChildSummaryView {
  readonly membershipId: string;
  readonly displayName: string;
  readonly avatarKey: string;
  readonly colorKey: string;
  readonly score: number;
  readonly pendingApprovals: number;
  readonly pendingMissed: number;
  readonly activeSanctions: number;
  readonly nextReward: RewardProgressView | null;
}

export interface ActionRequiredCountsView {
  readonly taskApprovals: number;
  readonly missedReviews: number;
  readonly rewardApprovals: number;
  /** Recompenses qui durent, detenues, dont le score est repasse sous le palier. */
  readonly rewardRevocations: number;
  readonly sanctionActivations: number;
  readonly sanctionLifts: number;
  readonly total: number;
}

/** Identite minimale d'un enfant, telle qu'affichee dans une carte de decision. */
export interface ChildIdentityView {
  readonly displayName: string;
  readonly avatarKey: string;
  readonly colorKey: string;
}
