import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getLedgerHistory } from '@/server/queries/history';
import { getChildDashboard } from '@/server/queries/child-dashboard';

export const metadata: Metadata = { title: 'Mes points' };

const TYPE_LABELS: Record<string, string> = {
  TASK_APPROVED: 'Tache validee',
  TASK_MISSED: 'Tache non realisee',
  MANUAL_ADJUSTMENT: 'Ajustement',
  REVERSAL: 'Correction',
};

/**
 * Historique de points de l'enfant.
 *
 * La requete est verrouillee cote serveur sur sa propre adhesion : meme en
 * modifiant l'URL, un enfant ne peut pas consulter l'historique d'un autre.
 */
const ChildPointsPage = async ({
  searchParams,
}: {
  readonly searchParams: Promise<{ cursor?: string }>;
}) => {
  const actor = await requireChildActor();
  const { cursor } = await searchParams;
  const [ledger, dashboard] = await Promise.all([
    getLedgerHistory(actor, { childMembershipId: null, cursor: cursor ?? null }),
    getChildDashboard(actor),
  ]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Card>
        <CardBody className="pt-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">Mon score</p>
          <p className="tabular mt-1 text-4xl font-semibold">{dashboard.score}</p>
          <p className="text-sm text-[var(--text-muted)]">points</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Mes mouvements de points" />
        <CardBody className="pt-0">
          {ledger.items.length === 0 ? (
            <EmptyState title="Aucun mouvement pour le moment" />
          ) : (
            <>
              <ul className="divide-y divide-[var(--border-subtle)]">
                {ledger.items.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 py-3">
                    <span
                      className={`tabular w-12 shrink-0 text-right text-sm font-semibold ${
                        row.delta > 0
                          ? 'text-leaf-700 dark:text-leaf-200'
                          : 'text-clay-700 dark:text-clay-200'
                      }`}
                    >
                      {row.delta > 0 ? '+' : '−'}
                      {Math.abs(row.delta)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{row.label}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {formatDateTime(row.createdAt, actor.timeZone)} ·{' '}
                        {TYPE_LABELS[row.type] ?? row.type}
                        {row.approvedBy !== null && <> · {row.approvedBy.user.displayName}</>}
                      </p>
                      {row.reason !== null && (
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">{row.reason}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {ledger.nextCursor !== null && (
                <a
                  href={`/enfant/points?cursor=${ledger.nextCursor}`}
                  className="text-pact-700 dark:text-pact-300 mt-4 inline-block text-sm font-medium underline underline-offset-4"
                >
                  Voir plus ancien
                </a>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default ChildPointsPage;
