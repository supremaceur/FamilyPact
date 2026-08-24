import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { createTaskDefinition, type TaskInput } from '@/server/services/task-definitions';

export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const body: unknown = await request.json();
    const created = await createTaskDefinition(actor, body as TaskInput);
    return jsonCreated(created);
  });
