import type { Metadata } from 'next';
import { PageBody } from '@/components/layout/page-body';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { formatDateTime } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getChildDashboard } from '@/server/queries/child-dashboard';

export const metadata: Metadata = { title: 'Mes sanctions' };

const ChildSanctionsPage = async () => {
  const actor = await requireChildActor();
  const data = await getChildDashboard(actor);

  return (
    <PageBody largeur="liste">
      <Card>
        <CardHeader title="Sanctions en cours" />
        <CardBody className="pt-0">
          {data.activeSanctions.length === 0 ? (
            <EmptyState title="Aucune sanction en cours" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {data.activeSanctions.map((sanction) => (
                <li key={sanction.id} className="py-4">
                  <p className="font-medium">{sanction.title}</p>
                  {sanction.description !== null && (
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">
                      {sanction.description}
                    </p>
                  )}

                  {sanction.liftScoreThreshold !== null && (
                    <div className="mt-3">
                      <div className="tabular flex items-baseline justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">
                          Objectif pour que ca s&apos;arrete
                        </span>
                        <span className="text-[var(--text-muted)]">
                          {data.score} / {sanction.liftScoreThreshold}
                        </span>
                      </div>
                      <ProgressBar
                        className="mt-1.5"
                        value={data.score}
                        max={sanction.liftScoreThreshold}
                        label={`Progression vers la fin de ${sanction.title}`}
                      />
                    </div>
                  )}

                  {sanction.liftAt !== null && (
                    <p className="mt-3 text-sm text-[var(--text-secondary)]">
                      Fin prevue : {formatDateTime(sanction.liftAt, actor.timeZone)}
                    </p>
                  )}

                  {sanction.status === 'LIFT_ELIGIBLE' && (
                    <p className="text-amber-soft-700 dark:text-amber-soft-200 mt-3 text-sm">
                      Tu as atteint la condition. Un parent doit maintenant lever la sanction.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </PageBody>
  );
};

export default ChildSanctionsPage;
