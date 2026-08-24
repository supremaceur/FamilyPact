import type { Metadata } from 'next';
import { AuditAction, ParentPermission } from '@/generated/prisma/enums';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { getAuditHistory } from '@/server/queries/history';

export const metadata: Metadata = { title: 'Audit' };

/** Selection d'actions couramment recherchees, pour un filtre lisible. */
const FILTERABLE_ACTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: AuditAction.TASK_APPROVED, label: 'Taches validees' },
  { value: AuditAction.TASK_MISSED_CONFIRMED, label: 'Retraits confirmes' },
  { value: AuditAction.POINTS_ADJUSTED, label: 'Ajustements manuels' },
  { value: AuditAction.POINTS_REVERSED, label: 'Annulations' },
  { value: AuditAction.REWARD_GRANTED, label: 'Recompenses validees' },
  { value: AuditAction.SANCTION_ACTIVATED, label: 'Sanctions activees' },
  { value: AuditAction.SANCTION_LIFTED, label: 'Sanctions levees' },
  { value: AuditAction.MEMBER_PERMISSIONS_UPDATED, label: 'Permissions modifiees' },
  { value: AuditAction.INVITATION_CREATED, label: 'Invitations creees' },
  { value: AuditAction.PARENT_LOGIN_FAILED, label: 'Echecs de connexion' },
];

/**
 * Journal d'audit.
 *
 * Distinct du ledger : il retrace QUI a decide QUOI, y compris les operations
 * de securite. Il ne contient jamais de secret — ni mot de passe, ni secret
 * TOTP, ni code de recuperation, ni jeton d'invitation en clair.
 */
const AuditPage = async ({
  searchParams,
}: {
  readonly searchParams: Promise<{ action?: string; cursor?: string }>;
}) => {
  const actor = await requireParentActor();
  if (!hasCapability(actor, ParentPermission.AUDIT_VIEW)) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert tone="info" title="Acces restreint">
          Vous n&apos;avez pas la permission de consulter le journal d&apos;audit. Le proprietaire
          de la famille peut vous l&apos;accorder.
        </Alert>
      </div>
    );
  }

  const { action, cursor } = await searchParams;
  const entries = await getAuditHistory(actor, {
    childMembershipId: null,
    actorMembershipId: null,
    action: (action as AuditAction | undefined) ?? null,
    from: null,
    to: null,
    cursor: cursor ?? null,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader
          title="Journal d'audit"
          description="Toutes les actions sensibles, avec leur auteur et leur date. Aucun secret n'y figure."
        />
        <CardBody className="pt-0">
          <nav aria-label="Filtrer par type d'action" className="mb-4 flex flex-wrap gap-2">
            <a
              href="/parent/audit"
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${
                action === undefined
                  ? 'border-pact-600 bg-pact-600 text-white'
                  : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
              }`}
            >
              Tout
            </a>
            {FILTERABLE_ACTIONS.map((item) => (
              <a
                key={item.value}
                href={`/parent/audit?action=${item.value}`}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${
                  action === item.value
                    ? 'border-pact-600 bg-pact-600 text-white'
                    : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {entries.items.length === 0 ? (
            <EmptyState title="Aucune entree pour ce filtre" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {entries.items.map((entry) => (
                <li key={entry.id} className="py-3">
                  <p className="text-sm">{entry.summary}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {formatDateTime(entry.createdAt, actor.timeZone)} · {entry.action}
                    {entry.actorLabel !== null && <> · {entry.actorLabel}</>}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {entries.nextCursor !== null && (
            <a
              href={`/parent/audit?cursor=${entries.nextCursor}${action !== undefined ? `&action=${action}` : ''}`}
              className="text-pact-700 dark:text-pact-300 mt-4 inline-block text-sm font-medium underline underline-offset-4"
            >
              Voir plus ancien
            </a>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default AuditPage;
