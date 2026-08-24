import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { updateParentPermissions, type PermissionUpdateInput } from '@/server/services/family';

/** Modification des permissions d'un parent : proprietaire uniquement, step-up requis. */
export const PUT = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    await updateParentPermissions(actor, (await request.json()) as PermissionUpdateInput);
    return jsonOk({ ok: true });
  });
