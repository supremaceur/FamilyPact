'use client';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiDelete } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

export interface InvitationRow {
  readonly id: string;
  readonly targetRole: string;
  readonly status: 'PENDING' | 'CONSUMED' | 'REVOKED';
  readonly label: string | null;
  readonly createdAtLabel: string;
  readonly expiresAtLabel: string;
  readonly createdByName: string | null;
  readonly consumedByName: string | null;
  readonly expired: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  CHILD: 'Enfant',
  PARENT: 'Parent',
  ADMIN: 'Administrateur',
  OWNER: 'Proprietaire',
};

export const InvitationList = ({
  invitations,
}: {
  readonly invitations: readonly InvitationRow[];
}) => {
  const action = useAction();

  return (
    <>
      {action.error !== null && (
        <Alert tone="error" className="mb-3">
          {action.error}
        </Alert>
      )}
      <ul className="divide-y divide-[var(--border-subtle)]">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {ROLE_LABELS[invitation.targetRole] ?? invitation.targetRole}
                {invitation.label !== null && (
                  <span className="text-[var(--text-muted)]"> — {invitation.label}</span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Creee le {invitation.createdAtLabel}
                {invitation.createdByName !== null && <> par {invitation.createdByName}</>} · expire
                le {invitation.expiresAtLabel}
              </p>
              {invitation.consumedByName !== null && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Utilisee par {invitation.consumedByName}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge
                tone={
                  invitation.status === 'CONSUMED'
                    ? 'positive'
                    : invitation.status === 'REVOKED' || invitation.expired
                      ? 'neutral'
                      : 'pending'
                }
              >
                {invitation.status === 'CONSUMED'
                  ? 'Utilisee'
                  : invitation.status === 'REVOKED'
                    ? 'Revoquee'
                    : invitation.expired
                      ? 'Expiree'
                      : 'En attente'}
              </Badge>
              {invitation.status === 'PENDING' && !invitation.expired && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={action.pending}
                  onClick={() =>
                    void action.run(() => apiDelete(`/api/invitations/${invitation.id}`))
                  }
                >
                  Revoquer
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
};
