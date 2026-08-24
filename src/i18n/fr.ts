/**
 * Libelles de l'interface.
 *
 * La V1 est monolingue (francais), mais toutes les chaines visibles passent par
 * ce dictionnaire plat. Ajouter une langue consistera a fournir un second
 * dictionnaire de meme forme et a resoudre la langue depuis
 * `Family.locale` / `User.locale` — sans reecrire les composants.
 */
export const fr = {
  appName: 'FamiliPact',
  tagline: 'Les regles familiales, simplement.',

  common: {
    save: 'Enregistrer',
    cancel: 'Annuler',
    confirm: 'Confirmer',
    back: 'Retour',
    close: 'Fermer',
    loading: 'Chargement…',
    points: 'points',
    point: 'point',
    none: 'Aucun',
    required: 'obligatoire',
    optional: 'facultatif',
    yes: 'Oui',
    no: 'Non',
  },

  nav: {
    parentDashboard: 'Tableau de bord',
    children: 'Enfants',
    tasks: 'Taches',
    approvals: 'Validations',
    rules: 'Regles',
    rewards: 'Recompenses',
    sanctions: 'Sanctions',
    history: 'Historique',
    members: 'Membres',
    settings: 'Parametres',
    security: 'Securite',
    audit: 'Audit',
    notifications: 'Notifications',
    childDashboard: 'Accueil',
    myTasks: 'Mes taches',
    myPoints: 'Mes points',
    myRewards: 'Mes recompenses',
    myProfile: 'Mon profil',
  },

  dashboard: {
    actionsRequired: 'Actions requises',
    noActions: 'Rien ne demande votre attention pour le moment.',
    nextReward: 'Prochaine recompense',
    noNextReward: 'Aucun palier defini pour le moment.',
    remaining: (value: number) => `${value} ${value > 1 ? 'points restants' : 'point restant'}`,
    pendingApprovals: (value: number) =>
      value === 1 ? '1 tache en attente de validation' : `${value} taches en attente de validation`,
    pendingMissed: (value: number) =>
      value === 1 ? '1 tache a confirmer' : `${value} taches a confirmer`,
    activeSanctions: (value: number) =>
      value === 1 ? '1 sanction active' : `${value} sanctions actives`,
  },

  tasks: {
    claimDone: "J'ai termine",
    approve: 'Valider',
    reject: 'Refuser',
    confirmMissed: 'Confirmer le retrait',
    ignoreMissed: 'Ignorer',
    todo: 'A faire',
    awaitingParent: 'En attente de validation',
    noTasksToday: "Aucune tache pour aujourd'hui.",
    dueAt: 'Avant',
  },

  errors: {
    generic: 'Une erreur est survenue. Reessayez dans un instant.',
    network: 'Connexion perdue. Verifiez votre reseau puis reessayez.',
    alreadyDecided: 'Cette decision a deja ete prise par un autre parent.',
  },
} as const;

export type Dictionary = typeof fr;

/** Point d'extension i18n : resoudra la locale de l'utilisateur en V2. */
export const getDictionary = (_locale = 'fr'): Dictionary => fr;
