'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiPatch } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

type Status = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

const NEXT_STATES: readonly { readonly status: Status; readonly label: string }[] = [
  { status: 'ACTIVE', label: 'Activer' },
  { status: 'INACTIVE', label: 'Suspendre' },
  { status: 'ARCHIVED', label: 'Archiver' },
];

export const TaskStatusControls = ({
  taskId,
  status,
}: {
  readonly taskId: string;
  readonly status: Status;
}) => {
  const action = useAction();

  return (
    <div className="flex flex-col gap-3">
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        {NEXT_STATES.filter((state) => state.status !== status).map((state) => (
          <Button
            key={state.status}
            variant={state.status === 'ARCHIVED' ? 'danger' : 'secondary'}
            size="sm"
            disabled={action.pending}
            onClick={() =>
              void action.run(() => apiPatch(`/api/tasks/${taskId}`, { status: state.status }))
            }
          >
            {state.label}
          </Button>
        ))}
      </div>
    </div>
  );
};
