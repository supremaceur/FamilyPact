import type { Metadata } from 'next';
import { DashboardColumn, DashboardGrid, PageBody } from '@/components/layout/page-body';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { formatDate } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getChildDashboard } from '@/server/queries/child-dashboard';

export const metadata: Metadata = { title: 'Mes recompenses' };

const ChildRewardsPage = async () => {
  const actor = await requireChildActor();
  const data = await getChildDashboard(actor);

  return (
    <PageBody largeur="liste">
      <DashboardGrid>
        <DashboardColumn>
          <Card>
            <CardHeader title="Prochaine recompense" />
            <CardBody className="pt-0">
              {data.nextReward === null ? (
                <EmptyState
                  title="Aucune recompense prevue"
                  description="Tes parents n'ont pas encore defini de palier. Tes points continuent de se cumuler."
                />
              ) : (
                <div>
                  <p className="font-medium">{data.nextReward.title}</p>
                  <ProgressBar
                    className="mt-3"
                    value={data.score}
                    max={data.nextReward.threshold}
                    label={`Progression vers ${data.nextReward.title}`}
                  />
                  <div className="tabular mt-2 flex items-baseline justify-between text-sm">
                    <span className="text-[var(--text-muted)]">
                      {data.score} / {data.nextReward.threshold}
                    </span>
                    <span className="font-medium">
                      {data.nextReward.remaining === 0
                        ? 'Palier atteint — un parent doit valider'
                        : `${data.nextReward.remaining} point${data.nextReward.remaining > 1 ? 's' : ''} restant${data.nextReward.remaining > 1 ? 's' : ''}`}
                    </span>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        </DashboardColumn>

        <DashboardColumn>
          <Card>
            <CardHeader title="Recompenses obtenues" />
            <CardBody className="pt-0">
              {data.grantedRewards.length === 0 ? (
                <EmptyState title="Aucune recompense obtenue pour le moment" />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.grantedRewards.map((reward) => (
                    <li key={reward.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{reward.title}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          Palier {reward.threshold} points
                          {reward.decidedAt !== null && (
                            <> · obtenue le {formatDate(reward.decidedAt, actor.timeZone)}</>
                          )}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs text-[var(--text-muted)]">
                Une recompense obtenue reste acquise, meme si ton score redescend ensuite. Elle ne
                te coute aucun point.
              </p>
            </CardBody>
          </Card>
        </DashboardColumn>
      </DashboardGrid>
    </PageBody>
  );
};

export default ChildRewardsPage;
