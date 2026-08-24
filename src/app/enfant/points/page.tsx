import type { Metadata } from 'next';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getFamilyTimeline } from '@/server/queries/history';
import { getChildDashboard } from '@/server/queries/child-dashboard';

export const metadata: Metadata = { title: 'Mes points' };

const TYPE_LABELS: Record<string, string> = {
  TASK_APPROVED: 'Tache validee',
  TASK_MISSED: 'Tache non realisee',
  TASK_REJECTED: 'Tache refusee',
  MANUAL_ADJUSTMENT: 'Ajustement',
  REVERSAL: 'Correction',
};

/** Decisions sans effet sur les points : elles comptent aussi dans l'histoire. */
const DECISION_LABELS: Record<string, string> = {
  TASK_REJECTED: 'Tache refusee — aucun point retire',
  TASK_MISSED_IGNORED: 'Echeance depassee — ignoree',
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
  const [timeline, dashboard] = await Promise.all([
    getFamilyTimeline(actor, { childMembershipId: null, cursor: cursor ?? null }),
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
        <CardHeader title="Mon historique" />
        <CardBody className="pt-0">
          {timeline.items.length === 0 ? (
            <EmptyState title="Rien pour le moment" />
          ) : (
            <>
              <ul className="divide-y divide-[var(--border-subtle)]">
                {timeline.items.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 py-3">
                    {row.kind === 'POINTS' ? (
                      <span
                        className={`tabular w-12 shrink-0 text-right text-sm font-semibold ${
                          row.delta > 0
                            ? 'text-leaf-700 dark:text-leaf-200'
                            : 'text-clay-700 dark:text-clay-200'
                        }`}
                      >
                        {row.delta > 0 ? '+' : '\u2212'}
                        {Math.abs(row.delta)}
                      </span>
                    ) : (
                      <span
                        className="w-12 shrink-0 text-right text-sm text-[var(--text-muted)]"
                        aria-label="Aucun point retire ni accorde"
                      >
                        &mdash;
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{row.kind === 'POINTS' ? row.label : row.summary}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {formatDateTime(row.at, actor.timeZone)} \u00b7{' '}
                        {row.kind === 'POINTS'
                          ? (TYPE_LABELS[row.type] ?? row.type)
                          : (DECISION_LABELS[row.action] ?? row.action)}
                        {row.actorName !== null && <> \u00b7 {row.actorName}</>}
                      </p>
                      {row.reason !== null && (
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">{row.reason}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {timeline.nextCursor !== null && (
                <a
                  href={`/enfant/points?cursor=${encodeURIComponent(timeline.nextCursor)}`}
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
