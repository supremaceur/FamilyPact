import { type NextRequest } from 'next/server';
import type { TaskDefinitionStatus } from '@/generated/prisma/enums';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import {
  setTaskDefinitionStatus,
  updateTaskDefinition,
  type TaskInput,
} from '@/server/services/task-definitions';

export const PUT = (request: NextRequest, context: { params: Promise<{ taskId: string }> }) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { taskId } = await context.params;
    await updateTaskDefinition(actor, taskId, (await request.json()) as TaskInput);
    return jsonOk({ ok: true });
  });

/** Changement de statut (activer / desactiver / archiver). */
export const PATCH = (request: NextRequest, context: { params: Promise<{ taskId: string }> }) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { taskId } = await context.params;
    const body = (await request.json()) as { status?: unknown };
    await setTaskDefinitionStatus(actor, taskId, body.status as TaskDefinitionStatus);
    return jsonOk({ ok: true });
  });
