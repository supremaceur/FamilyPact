/**
 * Matrice RBAC de FamiliPact — source de verite unique de l'autorisation.
 *
 * Ce module est PUR : il ne connait ni la base ni HTTP. La couche service
 * (src/server/services) l'interroge avant toute ecriture, et l'interface ne
 * fait que refleter ses reponses. Un controle uniquement cote client n'a
 * aucune valeur : toute decision passe forcement par `can()` cote serveur.
 *
 * Voir docs/permissions.md.
 */

import { FamilyRole, ParentPermission } from '@/generated/prisma/enums';

export { FamilyRole, ParentPermission };

/**
 * Capacites reservees au proprietaire. Elles ne figurent PAS dans
 * `ParentPermission` : elles ne sont donc pas octroyables, par construction.
 */
export const OwnerCapability = {
  MEMBER_MANAGE: 'MEMBER_MANAGE',
  PERMISSION_MANAGE: 'PERMISSION_MANAGE',
  OWNERSHIP_TRANSFER: 'OWNERSHIP_TRANSFER',
  FAMILY_DELETE: 'FAMILY_DELETE',
} as const;

export type OwnerCapability = (typeof OwnerCapability)[keyof typeof OwnerCapability];

export type Capability = ParentPermission | OwnerCapability;

export const ALL_PARENT_PERMISSIONS: readonly ParentPermission[] = [
  ParentPermission.TASK_MANAGE,
  ParentPermission.TASK_APPROVE,
  ParentPermission.TASK_CONFIRM_MISSED,
  ParentPermission.POINTS_ADJUST,
  ParentPermission.RULE_MANAGE,
  ParentPermission.REWARD_APPROVE,
  ParentPermission.SANCTION_ACTIVATE,
  ParentPermission.SANCTION_LIFT,
  ParentPermission.CHILD_MANAGE,
  ParentPermission.FAMILY_SETTINGS_MANAGE,
  ParentPermission.AUDIT_VIEW,
];

/**
 * Permissions octroyees par defaut a un nouveau membre PARENT.
 * Volontairement minimales : un parent invite peut participer aux validations
 * quotidiennes, mais pas redefinir le cadre familial tant que le proprietaire
 * ne le lui accorde pas explicitement.
 */
export const DEFAULT_PARENT_PERMISSIONS: readonly ParentPermission[] = [
  ParentPermission.TASK_APPROVE,
  ParentPermission.TASK_CONFIRM_MISSED,
];

/**
 * ADMIN dispose de tout l'operationnel familial, mais ne touche ni a la
 * composition de la famille, ni aux permissions, ni a la propriete.
 */
const ADMIN_PERMISSIONS: readonly ParentPermission[] = ALL_PARENT_PERMISSIONS;

/** Operations exigeant une re-authentification forte recente (step-up). */
export const SENSITIVE_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  OwnerCapability.MEMBER_MANAGE,
  OwnerCapability.PERMISSION_MANAGE,
  OwnerCapability.OWNERSHIP_TRANSFER,
  OwnerCapability.FAMILY_DELETE,
]);

/** Vue minimale d'une adhesion, suffisante pour decider. */
export interface AuthorizationSubject {
  readonly role: FamilyRole;
  readonly permissions: readonly ParentPermission[];
}

export const isParentRole = (role: FamilyRole): boolean => role !== FamilyRole.CHILD;

const isParentPermission = (capability: Capability): capability is ParentPermission =>
  (ALL_PARENT_PERMISSIONS as readonly string[]).includes(capability);

/**
 * Permissions effectives d'une adhesion : celles heritees du role, plus celles
 * octroyees explicitement pour un role PARENT.
 */
export const effectivePermissions = (
  subject: AuthorizationSubject,
): readonly ParentPermission[] => {
  switch (subject.role) {
    case FamilyRole.OWNER:
      return ALL_PARENT_PERMISSIONS;
    case FamilyRole.ADMIN:
      return ADMIN_PERMISSIONS;
    case FamilyRole.PARENT:
      return subject.permissions;
    case FamilyRole.CHILD:
      return [];
  }
};

/** Le sujet peut-il exercer cette capacite ? */
export const can = (subject: AuthorizationSubject, capability: Capability): boolean => {
  // Un enfant n'a aucune capacite d'administration, quelles que soient les
  // permissions eventuellement presentes en base.
  if (subject.role === FamilyRole.CHILD) return false;

  if (!isParentPermission(capability)) {
    // Capacites reservees au proprietaire.
    return subject.role === FamilyRole.OWNER;
  }

  return effectivePermissions(subject).includes(capability);
};

/** Cette capacite exige-t-elle une re-authentification recente ? */
export const requiresStepUp = (capability: Capability): boolean =>
  SENSITIVE_CAPABILITIES.has(capability);

/** Les permissions sont-elles modifiables pour ce role ? */
export const permissionsAreConfigurable = (role: FamilyRole): boolean => role === FamilyRole.PARENT;

/** Libelles francais des permissions, utilises par l'interface et l'audit. */
export const PERMISSION_LABELS: Readonly<Record<ParentPermission, string>> = {
  TASK_MANAGE: 'Creer et modifier les taches',
  TASK_APPROVE: 'Valider les taches terminees',
  TASK_CONFIRM_MISSED: 'Confirmer les taches non realisees',
  POINTS_ADJUST: 'Ajuster les points manuellement',
  RULE_MANAGE: 'Definir les regles de recompense et de sanction',
  REWARD_APPROVE: 'Valider les recompenses proposees',
  SANCTION_ACTIVATE: 'Activer les sanctions proposees',
  SANCTION_LIFT: 'Lever les sanctions',
  CHILD_MANAGE: 'Gerer les enfants',
  FAMILY_SETTINGS_MANAGE: 'Modifier les parametres de la famille',
  AUDIT_VIEW: "Consulter le journal d'audit",
};

export const PERMISSION_DESCRIPTIONS: Readonly<Record<ParentPermission, string>> = {
  TASK_MANAGE: 'Creer, modifier, activer ou archiver les taches des enfants.',
  TASK_APPROVE: "Accorder ou refuser les points d'une tache declaree terminee.",
  TASK_CONFIRM_MISSED: "Confirmer ou ignorer le retrait de points d'une tache non realisee.",
  POINTS_ADJUST: 'Corriger un score avec un motif obligatoire, ou annuler une transaction.',
  RULE_MANAGE: 'Definir les paliers de recompense et les seuils de sanction.',
  REWARD_APPROVE: 'Valider ou ignorer une recompense proposee par le systeme.',
  SANCTION_ACTIVATE: 'Activer ou ignorer une sanction proposee par le systeme.',
  SANCTION_LIFT: 'Lever une sanction active.',
  CHILD_MANAGE: 'Inviter un enfant, modifier son profil ou le retirer de la famille.',
  FAMILY_SETTINGS_MANAGE: 'Modifier le nom, le fuseau horaire et les preferences de la famille.',
  AUDIT_VIEW: "Consulter l'historique detaille des actions sensibles.",
};

export const ROLE_LABELS: Readonly<Record<FamilyRole, string>> = {
  OWNER: 'Proprietaire',
  ADMIN: 'Administrateur',
  PARENT: 'Parent',
  CHILD: 'Enfant',
};
