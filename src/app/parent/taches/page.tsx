import type { Metadata } from 'next';
import Link from 'next/link';
import { RECURRENCE_LABELS, WEEKDAY_SHORT_LABELS } from '@/domain/tasks';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { ParentPermission } from '@/generated/prisma/enums';
import { listTaskDefinitions } from '@/server/queries/parent-lists';

export const metadata: Metadata = { title: 'Taches' };

const STATUS_TONE = {
  ACTIVE: 'positive',
  INACTIVE: 'neutral',
  ARCHIVED: 'neutral',
} as const;

const STATUS_LABEL = {
  ACTIVE: 'Active',
  INACTIVE: 'Suspendue',
  ARCHIVED: 'Archivee',
} as const;

const TasksPage = async () => {
  const actor = await requireParentActor();
  const tasks = await listTaskDefinitions(actor);
  const canManage = hasCapability(actor, ParentPermission.TASK_MANAGE);

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader
          title="Taches"
          description="Chaque tache genere des occurrences datees, pour que chaque realisation soit historisee separement."
          action={
            canManage ? (
              <Link href="/parent/taches/nouvelle">
                <Button size="sm">Nouvelle tache</Button>
              </Link>
            ) : undefined
          }
        />
        <CardBody className="pt-0">
          {tasks.length === 0 ? (
            <EmptyState
              title="Aucune tache definie"
              description="Creez une premiere tache : elle apparaitra immediatement dans l'espace de l'enfant concerne."
              action={
                canManage ? (
                  <Link href="/parent/taches/nouvelle">
                    <Button>Creer une tache</Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {tasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/parent/taches/${task.id}`}
                    className="flex items-start gap-3 py-4 hover:opacity-80"
                  >
                    <Avatar
                      avatarKey={task.child.childProfile?.avatarKey ?? 'fox'}
                      colorKey={task.child.childProfile?.colorKey ?? 'sage'}
                      name={task.child.user.displayName}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{task.title}</p>
                        <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                        {task.child.user.displayName} · {RECURRENCE_LABELS[task.recurrence]}
                        {task.recurrence === 'WEEKLY_DAYS' && task.weekdays.length > 0 && (
                          <>
                            {' '}
                            ({task.weekdays.map((day) => WEEKDAY_SHORT_LABELS[day - 1]).join(' ')})
                          </>
                        )}
                        {task.dueTime !== null && <> · avant {task.dueTime}</>}
                      </p>
                      <p className="mt-1 text-sm">
                        <span className="text-leaf-700 dark:text-leaf-200 font-medium">
                          +{task.pointsAward}
                        </span>
                        {task.pointsPenalty > 0 && (
                          <>
                            {' '}
                            <span className="text-[var(--text-muted)]">/</span>{' '}
                            <span className="text-clay-700 dark:text-clay-200 font-medium">
                              −{task.pointsPenalty}
                            </span>
                          </>
                        )}
                        <span className="ml-2 text-[var(--text-muted)]">
                          {task._count.occurrences} occurrence
                          {task._count.occurrences > 1 ? 's' : ''}
                        </span>
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default TasksPage;
