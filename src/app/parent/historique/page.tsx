import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { requireParentActor } from '@/server/auth/context';
import { getLedgerHistory } from '@/server/queries/history';
import { listChildren } from '@/server/services/children';

export const metadata: Metadata = { title: 'Historique' };

const TYPE_LABELS: Record<string, string> = {
  TASK_APPROVED: 'Tache validee',
  TASK_MISSED: 'Tache non realisee',
  MANUAL_ADJUSTMENT: 'Ajustement manuel',
  REVERSAL: 'Annulation',
};

/**
 * Historique familial des mouvements de points.
 *
 * Filtrable par enfant, pagine par curseur. Les horaires sont rendus dans le
 * fuseau de la famille, pas dans celui du navigateur : deux parents dans deux
 * pays lisent la meme heure.
 */
const HistoryPage = async ({
  searchParams,
}: {
  readonly searchParams: Promise<{ enfant?: string; cursor?: string }>;
}) => {
  const actor = await requireParentActor();
  const { enfant, cursor } = await searchParams;
  const [ledger, children] = await Promise.all([
    getLedgerHistory(actor, { childMembershipId: enfant ?? null, cursor: cursor ?? null }),
    listChildren(actor),
  ]);

  const buildHref = (childId: string | null): string =>
    childId === null ? '/parent/historique' : `/parent/historique?enfant=${childId}`;

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader
          title="Historique des points"
          description={`Horaires affiches dans le fuseau de la famille (${actor.timeZone}).`}
        />
        <CardBody className="pt-0">
          <nav aria-label="Filtrer par enfant" className="mb-4 flex flex-wrap gap-2">
            <a
              href={buildHref(null)}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${
                enfant === undefined
                  ? 'border-pact-600 bg-pact-600 text-white'
                  : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
              }`}
            >
              Tous
            </a>
            {children.map((child) => (
              <a
                key={child.id}
                href={buildHref(child.id)}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm ${
                  enfant === child.id
                    ? 'border-pact-600 bg-pact-600 text-white'
                    : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
                }`}
              >
                {child.user.displayName}
              </a>
            ))}
          </nav>

          {ledger.items.length === 0 ? (
            <EmptyState title="Aucun mouvement pour ce filtre" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {ledger.items.map((row) => (
                <li key={row.id} className="flex items-start gap-3 py-3">
                  <span
                    className={`tabular w-14 shrink-0 text-right text-sm font-semibold ${
                      row.delta > 0
                        ? 'text-leaf-700 dark:text-leaf-200'
                        : 'text-clay-700 dark:text-clay-200'
                    }`}
                  >
                    {row.delta > 0 ? '+' : '−'}
                    {Math.abs(row.delta)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{row.child.user.displayName}</span>
                      {' — '}
                      {row.label}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {formatDateTime(row.createdAt, actor.timeZone)} ·{' '}
                      {TYPE_LABELS[row.type] ?? row.type}
                      {row.approvedBy !== null && <> · par {row.approvedBy.user.displayName}</>}
                    </p>
                    {row.reason !== null && (
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        Motif : {row.reason}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {ledger.nextCursor !== null && (
            <a
              href={`/parent/historique?cursor=${ledger.nextCursor}${enfant !== undefined ? `&enfant=${enfant}` : ''}`}
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

export default HistoryPage;
