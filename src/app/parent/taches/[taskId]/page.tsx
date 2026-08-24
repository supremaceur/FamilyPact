import type { Metadata } from 'next';
import { PageBody } from '@/components/layout/page-body';
import { TASK_STATE_LABELS } from '@/domain/tasks';
import { ParentPermission } from '@/generated/prisma/enums';
import { TaskForm } from '@/components/parent/task-form';
import { TaskStatusControls } from '@/components/parent/task-status-controls';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { getTaskDefinition } from '@/server/queries/parent-lists';
import { listChildren } from '@/server/services/children';

export const metadata: Metadata = { title: 'Modifier une tache' };

const STATE_TONE = {
  TODO: 'neutral',
  CLAIMED_DONE: 'pending',
  APPROVED: 'positive',
  REJECTED: 'neutral',
  MISSED_PENDING_REVIEW: 'pending',
  MISSED_CONFIRMED: 'negative',
  MISSED_IGNORED: 'neutral',
} as const;

const TaskDetailPage = async ({ params }: { readonly params: Promise<{ taskId: string }> }) => {
  const actor = await requireParentActor();
  const { taskId } = await params;
  const [task, children] = await Promise.all([
    getTaskDefinition(actor, taskId),
    listChildren(actor),
  ]);
  const canManage = hasCapability(actor, ParentPermission.TASK_MANAGE);

  return (
    <PageBody largeur="lecture" className="flex flex-col gap-6">
      {canManage && (
        <Card>
          <CardHeader title="Modifier la tache" description={`Version ${task.version}`} />
          <CardBody>
            <TaskForm
              taskId={task.id}
              children={children.map((child) => ({
                id: child.id,
                displayName: child.user.displayName,
              }))}
              initial={{
                childMembershipId: task.childMembershipId,
                title: task.title,
                description: task.description ?? '',
                pointsAward: task.pointsAward,
                pointsPenalty: task.pointsPenalty,
                recurrence: task.recurrence,
                startDate: task.startDate,
                endDate: task.endDate ?? '',
                dueTime: task.dueTime ?? '19:00',
                weekdays: task.weekdays,
              }}
            />
          </CardBody>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader
            title="Statut de la tache"
            description="Suspendre retire les occurrences futures encore a faire, sans toucher a l'historique."
          />
          <CardBody>
            <TaskStatusControls taskId={task.id} status={task.status} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Occurrences"
          description="Chaque occurrence conserve le libelle et les points en vigueur au moment de sa creation."
        />
        <CardBody className="pt-0">
          {task.occurrences.length === 0 ? (
            <EmptyState title="Aucune occurrence generee pour le moment" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {task.occurrences.map((occurrence) => (
                <li key={occurrence.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{occurrence.titleSnapshot}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {occurrence.occurrenceDate} · echeance{' '}
                      {formatDateTime(occurrence.dueAt, actor.timeZone)} · version{' '}
                      {occurrence.definitionVersion}
                    </p>
                    {occurrence.decidedBy !== null && (
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        Decide par {occurrence.decidedBy.user.displayName}
                        {occurrence.decidedAt !== null &&
                          ` le ${formatDateTime(occurrence.decidedAt, actor.timeZone)}`}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={STATE_TONE[occurrence.state]}>
                      {TASK_STATE_LABELS[occurrence.state]}
                    </Badge>
                    <span className="tabular text-xs text-[var(--text-muted)]">
                      +{occurrence.pointsAwardSnapshot} / −{occurrence.pointsPenaltySnapshot}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </PageBody>
  );
};

export default TaskDetailPage;
