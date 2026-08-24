import type { Metadata } from 'next';
import { DashboardColumn, DashboardGrid, PageBody } from '@/components/layout/page-body';
import Link from 'next/link';
import { FamilyRole, ParentPermission } from '@/generated/prisma/enums';
import { InvitationList } from '@/components/parent/invitation-list';
import { InvitationPanel } from '@/components/parent/invitation-panel';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/format';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { listInvitations } from '@/server/services/invitations';
import { listChildren } from '@/server/services/children';

export const metadata: Metadata = { title: 'Enfants' };

const ChildrenPage = async () => {
  const actor = await requireParentActor();
  const canManage = hasCapability(actor, ParentPermission.CHILD_MANAGE);
  const children = await listChildren(actor);
  const invitations = canManage ? await listInvitations(actor) : [];
  const childInvitations = invitations.filter(
    (invitation) => invitation.targetRole === FamilyRole.CHILD,
  );

  const listeDesEnfants = (
    <Card>
      <CardHeader title="Les enfants de la famille" />
      <CardBody className="pt-0">
        {children.length === 0 ? (
          <EmptyState
            title="Aucun enfant pour le moment"
            description="Creez une invitation ci-dessous : l'enfant rejoindra la famille avec un code a usage unique, sans avoir besoin d'une adresse e-mail."
          />
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {children.map((child) => (
              <li key={child.id}>
                <Link
                  href={`/parent/enfants/${child.id}`}
                  className="flex items-center gap-3 py-3 hover:opacity-80"
                >
                  <Avatar
                    avatarKey={child.childProfile?.avatarKey ?? 'fox'}
                    colorKey={child.childProfile?.colorKey ?? 'sage'}
                    name={child.user.displayName}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{child.user.displayName}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      Identifiant : {child.user.loginId ?? '—'}
                    </p>
                  </div>
                  <span className="tabular text-lg font-semibold">
                    {child.childProfile?.cachedBalance ?? 0}
                    <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">pts</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );

  return (
    <PageBody largeur={canManage ? 'tableauDeBord' : 'liste'}>
      {/* Sans droit de gestion, la page se resume a la liste : ni colonne
          de droite, ni grille, donc pas de vide a droite. */}
      {canManage ? (
        <DashboardGrid>
          <DashboardColumn>{listeDesEnfants}</DashboardColumn>

          <DashboardColumn>
            <Card>
              <CardHeader
                title="Inviter un enfant"
                description="Le code est a usage unique et lie a cette famille. Il ne peut pas servir a creer un compte parent."
              />
              <CardBody>
                <InvitationPanel allowedRoles={[{ value: 'CHILD', label: 'Enfant' }]} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Invitations enfant" />
              <CardBody className="pt-0">
                {childInvitations.length === 0 ? (
                  <EmptyState title="Aucune invitation creee" />
                ) : (
                  <InvitationList
                    invitations={childInvitations.map((invitation) => ({
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
          </DashboardColumn>
        </DashboardGrid>
      ) : (
        listeDesEnfants
      )}
    </PageBody>
  );
};

export default ChildrenPage;
