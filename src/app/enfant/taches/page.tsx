import type { Metadata } from 'next';
import { DashboardColumn, DashboardGrid, PageBody } from '@/components/layout/page-body';
import { ClaimTaskButton } from '@/components/child/claim-task-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TASK_STATE_LABELS } from '@/domain/tasks';
import { formatDateTime, formatTime } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getChildDashboard } from '@/server/queries/child-dashboard';

export const metadata: Metadata = { title: 'Mes taches' };

const ChildTasksPage = async () => {
  const actor = await requireChildActor();
  const data = await getChildDashboard(actor);

  return (
    <PageBody largeur="liste">
      <DashboardGrid>
        <DashboardColumn>
          {/* Le lisere ne s'allume que s'il reste une tache a faire. */}
          <Card tone={data.todayTasks.length > 0 ? 'lead' : 'default'}>
            <CardHeader title="A faire" />
            <CardBody className="pt-0">
              {data.todayTasks.length === 0 ? (
                <EmptyState title="Aucune tache a faire" />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.todayTasks.map((task) => (
                    <li key={task.id} className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{task.title}</p>
                          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                            {task.occurrenceDate} · avant {formatTime(task.dueAt, actor.timeZone)}
                          </p>
                          {task.state === 'REJECTED' && task.decisionNote !== null && (
                            <p className="mt-1 text-sm text-[var(--text-secondary)]">
                              Message d&apos;un parent : {task.decisionNote}
                            </p>
                          )}
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
        </DashboardColumn>

        <DashboardColumn>
          <Card>
            <CardHeader
              title="En attente"
              description="Un parent doit encore verifier ces taches."
            />
            <CardBody className="pt-0">
              {data.pendingTasks.length === 0 ? (
                <EmptyState title="Rien en attente" />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.pendingTasks.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{task.title}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {formatDateTime(task.dueAt, actor.timeZone)}
                        </p>
                      </div>
                      <Badge tone="pending">{TASK_STATE_LABELS[task.state]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recemment terminees" />
            <CardBody className="pt-0">
              {data.recentlyDecided.length === 0 ? (
                <EmptyState title="Aucune tache terminee pour le moment" />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.recentlyDecided.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{task.title}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {TASK_STATE_LABELS[task.state]}
                        </p>
                      </div>
                      <span className="tabular shrink-0 text-sm font-semibold">
                        {task.state === 'APPROVED' && (
                          <span className="text-leaf-700 dark:text-leaf-200">
                            +{task.pointsAward}
                          </span>
                        )}
                        {task.state === 'MISSED_CONFIRMED' && (
                          <span className="text-clay-700 dark:text-clay-200">
                            −{task.pointsPenalty}
                          </span>
                        )}
                        {task.state === 'MISSED_IGNORED' && (
                          <span className="text-[var(--text-muted)]">0</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </DashboardColumn>
      </DashboardGrid>
    </PageBody>
  );
};

export default ChildTasksPage;
