import { describe, expect, it } from 'vitest';
import { FamilyRole, ParentPermission } from '@/generated/prisma/enums';
import {
  ALL_PARENT_PERMISSIONS,
  DEFAULT_PARENT_PERMISSIONS,
  OwnerCapability,
  can,
  effectivePermissions,
  permissionsAreConfigurable,
  requiresStepUp,
} from './permissions';

describe('matrice RBAC', () => {
  it('accorde tout au proprietaire, y compris les capacites exclusives', () => {
    const owner = { role: FamilyRole.OWNER, permissions: [] };
    for (const permission of ALL_PARENT_PERMISSIONS) {
      expect(can(owner, permission)).toBe(true);
    }
    expect(can(owner, OwnerCapability.MEMBER_MANAGE)).toBe(true);
    expect(can(owner, OwnerCapability.PERMISSION_MANAGE)).toBe(true);
    expect(can(owner, OwnerCapability.OWNERSHIP_TRANSFER)).toBe(true);
    expect(can(owner, OwnerCapability.FAMILY_DELETE)).toBe(true);
  });

  it("donne a l'administrateur tout l'operationnel, mais rien qui touche a la famille", () => {
    const admin = { role: FamilyRole.ADMIN, permissions: [] };
    for (const permission of ALL_PARENT_PERMISSIONS) {
      expect(can(admin, permission)).toBe(true);
    }
    expect(can(admin, OwnerCapability.MEMBER_MANAGE)).toBe(false);
    expect(can(admin, OwnerCapability.PERMISSION_MANAGE)).toBe(false);
    expect(can(admin, OwnerCapability.OWNERSHIP_TRANSFER)).toBe(false);
    expect(can(admin, OwnerCapability.FAMILY_DELETE)).toBe(false);
  });

  it('limite le parent a ses octrois explicites', () => {
    const parent = {
      role: FamilyRole.PARENT,
      permissions: [ParentPermission.TASK_APPROVE],
    };
    expect(can(parent, ParentPermission.TASK_APPROVE)).toBe(true);
    expect(can(parent, ParentPermission.POINTS_ADJUST)).toBe(false);
    expect(can(parent, ParentPermission.RULE_MANAGE)).toBe(false);
    expect(can(parent, OwnerCapability.MEMBER_MANAGE)).toBe(false);
  });

  it("n'accorde jamais rien a un enfant, meme si des permissions figurent en base", () => {
    // Situation anormale volontairement testee : une ligne d'octroi laissee par
    // un incident ne doit jamais donner de pouvoir a un compte enfant.
    const child = { role: FamilyRole.CHILD, permissions: [...ALL_PARENT_PERMISSIONS] };
    for (const permission of ALL_PARENT_PERMISSIONS) {
      expect(can(child, permission)).toBe(false);
    }
    expect(can(child, OwnerCapability.FAMILY_DELETE)).toBe(false);
    expect(effectivePermissions(child)).toEqual([]);
  });

  it('exige une re-authentification pour les seules operations sensibles', () => {
    expect(requiresStepUp(OwnerCapability.MEMBER_MANAGE)).toBe(true);
    expect(requiresStepUp(OwnerCapability.PERMISSION_MANAGE)).toBe(true);
    expect(requiresStepUp(OwnerCapability.OWNERSHIP_TRANSFER)).toBe(true);
    expect(requiresStepUp(OwnerCapability.FAMILY_DELETE)).toBe(true);
    // Les validations quotidiennes ne doivent pas etre alourdies.
    expect(requiresStepUp(ParentPermission.TASK_APPROVE)).toBe(false);
    expect(requiresStepUp(ParentPermission.POINTS_ADJUST)).toBe(false);
  });

  it('ne rend configurables que les permissions du role PARENT', () => {
    expect(permissionsAreConfigurable(FamilyRole.PARENT)).toBe(true);
    expect(permissionsAreConfigurable(FamilyRole.ADMIN)).toBe(false);
    expect(permissionsAreConfigurable(FamilyRole.OWNER)).toBe(false);
    expect(permissionsAreConfigurable(FamilyRole.CHILD)).toBe(false);
  });

  it('donne au parent invite un jeu de permissions minimal', () => {
    expect(DEFAULT_PARENT_PERMISSIONS).toEqual([
      ParentPermission.TASK_APPROVE,
      ParentPermission.TASK_CONFIRM_MISSED,
    ]);
    // Un parent invite ne redefinit pas le cadre familial par defaut.
    expect(DEFAULT_PARENT_PERMISSIONS).not.toContain(ParentPermission.RULE_MANAGE);
    expect(DEFAULT_PARENT_PERMISSIONS).not.toContain(ParentPermission.POINTS_ADJUST);
  });
});
