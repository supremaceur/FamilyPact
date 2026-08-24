import type { Metadata } from 'next';
import { FamilyRole } from '@/generated/prisma/enums';
import { InvitationList } from '@/components/parent/invitation-list';
import { InvitationPanel } from '@/components/parent/invitation-panel';
import { MemberManagement } from '@/components/parent/member-management';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ALL_PARENT_PERMISSIONS,
  OwnerCapability,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LABELS,
} from '@/domain/permissions';
import { formatDate } from '@/lib/format';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { listMembers } from '@/server/services/family';
import { listInvitations } from '@/server/services/invitations';

export const metadata: Metadata = { title: 'Membres' };

const MembersPage = async () => {
  const actor = await requireParentActor();
  const canManage = hasCapability(actor, OwnerCapability.MEMBER_MANAGE);
  const members = await listMembers(actor);
  const invitations = canManage ? await listInvitations(actor) : [];
  const parentInvitations = invitations.filter(
    (invitation) => invitation.targetRole !== FamilyRole.CHILD,
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader
          title="Membres de la famille"
          description="Les permissions sont verifiees cote serveur : masquer un bouton ne protege rien."
        />
        <CardBody className="pt-0">
          <MemberManagement
            canManage={canManage}
            permissionCatalogue={ALL_PARENT_PERMISSIONS.map((permission) => ({
              value: permission,
              label: PERMISSION_LABELS[permission],
              description: PERMISSION_DESCRIPTIONS[permission],
            }))}
            members={members.map((member) => ({
              membershipId: member.id,
              displayName: member.user.displayName,
              email: member.user.email,
              role: member.role,
              status: member.status,
              permissions: member.permissions.map((grant) => grant.permission),
              mfaReady: member.user.totpCredential?.confirmedAt != null,
              isSelf: member.id === actor.membershipId,
            }))}
          />
        </CardBody>
      </Card>

      {canManage ? (
        <>
          <Card>
            <CardHeader
              title="Inviter un parent"
              description="Le parent invite devra configurer sa double authentification avant d'exercer ses droits."
            />
            <CardBody>
              <InvitationPanel
                allowedRoles={[
                  { value: 'PARENT', label: 'Parent (permissions configurables)' },
                  { value: 'ADMIN', label: 'Administrateur (gestion complete du quotidien)' },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Invitations parent" />
            <CardBody className="pt-0">
              {parentInvitations.length === 0 ? (
                <EmptyState title="Aucune invitation parent creee" />
              ) : (
                <InvitationList
                  invitations={parentInvitations.map((invitation) => ({
                    id: invitation.id,
                    targetRole: invitation.targetRole,
                    status: invitation.status,
                    label: invitation.label,
                    createdAtLabel: formatDate(invitation.createdAt, actor.timeZone),
                    expiresAtLabel: formatDate(invitation.expiresAt, actor.timeZone),
                    createdByName: invitation.createdBy?.user.displayName ?? null,
                    consumedByName: invitation.consumedBy?.displayName ?? null,
                    expired: invitation.expiresAt.getTime() < Date.now(),
                  }))}
                />
              )}
            </CardBody>
          </Card>
        </>
      ) : (
        <Alert tone="info">
          Seul le proprietaire de la famille peut inviter un parent, modifier les permissions ou
          transferer la propriete.
        </Alert>
      )}
    </div>
  );
};

export default MembersPage;
