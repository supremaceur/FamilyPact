import type { Metadata } from 'next';
import Link from 'next/link';
import { ClaimTaskButton } from '@/components/child/claim-task-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { TASK_STATE_LABELS } from '@/domain/tasks';
import { formatDateTime, formatTime } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getChildDashboard } from '@/server/queries/child-dashboard';

export const metadata: Metadata = { title: 'Mon espace' };

/**
 * Tableau de bord enfant.
 *
 * Beaucoup plus simple que l'espace parent : le score, la prochaine
 * recompense, les taches du jour, les sanctions en cours. Rien d'autre.
 *
 * Aucune mecanique de jeu : la barre de progression est une information, pas
 * une recompense visuelle. Aucun badge, aucun niveau, aucune serie.
 */
const ChildDashboardPage = async () => {
  const actor = await requireChildActor();
  const data = await getChildDashboard(actor);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Card>
        <CardBody className="pt-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">Mon score</p>
          <p className="tabular mt-1 text-5xl font-semibold">{data.score}</p>
          <p className="text-sm text-[var(--text-muted)]">points</p>

          {data.nextReward === null ? (
            <p className="mt-6 text-sm text-[var(--text-muted)]">
              Aucune recompense n&apos;est prevue pour l&apos;instant.
            </p>
          ) : (
            <div className="mt-6 text-left">
              <p className="text-sm font-medium">Prochaine recompense : {data.nextReward.title}</p>
              <ProgressBar
                className="mt-2"
                value={data.score}
                max={data.nextReward.threshold}
                label={`Progression vers ${data.nextReward.title}`}
              />
              <div className="tabular mt-1.5 flex items-baseline justify-between text-sm">
                <span className="text-[var(--text-muted)]">
                  {data.score} / {data.nextReward.threshold}
                </span>
                <span className="font-medium">
                  {data.nextReward.remaining === 0
                    ? 'Palier atteint'
                    : `${data.nextReward.remaining} point${data.nextReward.remaining > 1 ? 's' : ''} restant${data.nextReward.remaining > 1 ? 's' : ''}`}
                </span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {data.activeSanctions.length > 0 && (
        <Card>
          <CardHeader title="Sanctions en cours" />
          <CardBody className="pt-0">
            <ul className="divide-y divide-[var(--border-subtle)]">
              {data.activeSanctions.map((sanction) => (
                <li key={sanction.id} className="py-3">
                  <p className="text-sm font-medium">{sanction.title}</p>
                  {sanction.description !== null && (
                    <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                      {sanction.description}
                    </p>
                  )}
                  {sanction.liftScoreThreshold !== null && (
                    <div className="mt-2">
                      <div className="tabular flex items-baseline justify-between text-xs">
                        <span className="text-[var(--text-muted)]">Pour que ca s&apos;arrete</span>
                        <span className="text-[var(--text-muted)]">
                          {data.score} / {sanction.liftScoreThreshold}
                        </span>
                      </div>
                      <ProgressBar
                        className="mt-1"
                        value={data.score}
                        max={sanction.liftScoreThreshold}
                        label={`Progression vers la fin de ${sanction.title}`}
                      />
                    </div>
                  )}
                  {sanction.liftAt !== null && (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      Fin prevue : {formatDateTime(sanction.liftAt, actor.timeZone)}
                    </p>
                  )}
                  {sanction.status === 'LIFT_ELIGIBLE' && (
                    <p className="text-amber-soft-700 dark:text-amber-soft-200 mt-2 text-xs">
                      La condition est atteinte. Un parent doit encore lever la sanction.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="A faire" />
        <CardBody className="pt-0">
          {data.todayTasks.length === 0 ? (
            <EmptyState title="Rien a faire pour le moment" description="Profite bien !" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {data.todayTasks.map((task) => (
                <li key={task.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{task.title}</p>
                      <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                        Avant {formatTime(task.dueAt, actor.timeZone)}
                      </p>
                    </div>
                    <span className="tabular text-leaf-700 dark:text-leaf-200 shrink-0 text-sm font-semibold">
                      +{task.pointsAward}
                    </span>
                  </div>
                  <ClaimTaskButton occurrenceId={task.id} points={task.pointsAward} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {data.pendingTasks.length > 0 && (
        <Card>
          <CardHeader
            title="En attente d'un parent"
            description="Ces taches ont ete transmises. Les points arriveront apres validation."
          />
          <CardBody className="pt-0">
            <ul className="divide-y divide-[var(--border-subtle)]">
              {data.pendingTasks.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 truncate text-sm">{task.title}</span>
                  <Badge tone="pending">{TASK_STATE_LABELS[task.state]}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Link
        href="/enfant/points"
        className="text-pact-700 dark:text-pact-300 text-center text-sm font-medium underline underline-offset-4"
      >
        Voir tout mon historique de points
      </Link>
    </div>
  );
};

export default ChildDashboardPage;
