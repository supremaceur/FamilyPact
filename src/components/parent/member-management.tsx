'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxGroup } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { StepUpPrompt } from '@/components/security/step-up-prompt';
import { apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

export interface MemberRow {
  readonly membershipId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly role: 'OWNER' | 'ADMIN' | 'PARENT' | 'CHILD';
  readonly status: 'ACTIVE' | 'REMOVED';
  readonly permissions: readonly string[];
  readonly mfaReady: boolean;
  readonly isSelf: boolean;
}

const ROLE_LABELS: Record<MemberRow['role'], string> = {
  OWNER: 'Proprietaire',
  ADMIN: 'Administrateur',
  PARENT: 'Parent',
  CHILD: 'Enfant',
};

/**
 * Gestion des membres adultes.
 *
 * Toutes les operations de ce composant sont sensibles cote serveur : elles
 * exigent le role de proprietaire ET une re-authentification recente. Le
 * composant affiche l'invite de verification quand le serveur la reclame,
 * plutot que de la demander systematiquement.
 */
export const MemberManagement = ({
  members,
  permissionCatalogue,
  canManage,
}: {
  readonly members: readonly MemberRow[];
  readonly permissionCatalogue: readonly {
    readonly value: string;
    readonly label: string;
    readonly description: string;
  }[];
  readonly canManage: boolean;
}) => {
  const action = useAction();
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const [transferring, setTransferring] = useState<MemberRow | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  const guard = async (operation: () => Promise<unknown>): Promise<void> => {
    const result = await action.run(operation);
    if (result === null) setNeedsStepUp(true);
  };

  return (
    <div className="flex flex-col gap-4">
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}
      {needsStepUp && (
        <StepUpPrompt
          onVerified={() => {
            setNeedsStepUp(false);
            action.reset();
          }}
        />
      )}

      <ul className="divide-y divide-[var(--border-subtle)]">
        {members.map((member) => (
          <li key={member.membershipId} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {member.displayName}
                  {member.isSelf && (
                    <span className="ml-2 text-xs text-[var(--text-muted)]">(vous)</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {member.email ?? 'Compte enfant'}
                </p>
                {member.role !== 'CHILD' && !member.mfaReady && (
                  <p className="text-amber-soft-700 dark:text-amber-soft-200 mt-1 text-xs">
                    Double authentification non configuree : ses privileges ne sont pas actifs.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Badge tone={member.status === 'REMOVED' ? 'neutral' : 'info'}>
                  {member.status === 'REMOVED' ? 'Retire' : ROLE_LABELS[member.role]}
                </Badge>
              </div>
            </div>

            {canManage &&
              member.status === 'ACTIVE' &&
              member.role !== 'CHILD' &&
              !member.isSelf && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {member.role === 'PARENT' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDraftPermissions([...member.permissions]);
                          setEditing(member);
                        }}
                      >
                        Permissions
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={action.pending}
                        onClick={() =>
                          void guard(() =>
                            apiPatch(`/api/family/members/${member.membershipId}`, {
                              role: 'ADMIN',
                            }),
                          )
                        }
                      >
                        Passer administrateur
                      </Button>
                    </>
                  )}
                  {member.role === 'ADMIN' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={action.pending}
                      onClick={() =>
                        void guard(() =>
                          apiPatch(`/api/family/members/${member.membershipId}`, {
                            role: 'PARENT',
                          }),
                        )
                      }
                    >
                      Repasser parent
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTransferring(member);
                    }}
                  >
                    Transferer la propriete
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-clay-700 dark:text-clay-200"
                    onClick={() => {
                      setRemoving(member);
                    }}
                  >
                    Retirer
                  </Button>
                </div>
              )}

            {member.role === 'PARENT' && member.permissions.length > 0 && (
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {member.permissions.length} permission
                {member.permissions.length > 1 ? 's' : ''} accordee
                {member.permissions.length > 1 ? 's' : ''}
              </p>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={editing !== null}
        title={`Permissions de ${editing?.displayName ?? ''}`}
        confirmLabel="Enregistrer"
        pending={action.pending}
        onCancel={() => {
          setEditing(null);
        }}
        onConfirm={() => {
          if (editing === null) return;
          void guard(async () => {
            await apiPut('/api/family/permissions', {
              membershipId: editing.membershipId,
              permissions: draftPermissions,
            });
            setEditing(null);
          });
        }}
      >
        <CheckboxGroup
          legend="Ce que ce parent peut faire"
          hint="Les permissions sont verifiees cote serveur a chaque action."
          options={permissionCatalogue}
          selected={draftPermissions}
          onToggle={(value, checked) => {
            setDraftPermissions((current) =>
              checked ? [...current, value] : current.filter((item) => item !== value),
            );
          }}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={removing !== null}
        title={`Retirer ${removing?.displayName ?? ''} de la famille ?`}
        confirmLabel="Retirer"
        confirmVariant="danger"
        pending={action.pending}
        onCancel={() => {
          setRemoving(null);
        }}
        onConfirm={() => {
          if (removing === null) return;
          void guard(async () => {
            await apiDelete(`/api/family/members/${removing.membershipId}`);
            setRemoving(null);
          });
        }}
      >
        <p>
          Ses sessions seront fermees immediatement et il n&apos;aura plus acces a la famille. Les
          decisions qu&apos;il a prises restent visibles dans l&apos;historique : elles ne sont pas
          effacees.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={transferring !== null}
        title={`Transferer la propriete a ${transferring?.displayName ?? ''} ?`}
        confirmLabel="Transferer"
        confirmVariant="danger"
        pending={action.pending}
        onCancel={() => {
          setTransferring(null);
        }}
        onConfirm={() => {
          if (transferring === null) return;
          void guard(async () => {
            await apiPost('/api/family/ownership', { membershipId: transferring.membershipId });
            setTransferring(null);
          });
        }}
      >
        <p>
          {transferring?.displayName} deviendra proprietaire de la famille. Vous deviendrez
          administrateur et perdrez la gestion des membres, des permissions et de la suppression de
          la famille.
        </p>
      </ConfirmDialog>
    </div>
  );
};
