import { type NextRequest } from 'next/server';
import { requireFamilyActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { markNotificationsRead } from '@/server/queries/history';

/** Marque des notifications comme lues (ou toutes, si la liste est vide). */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireFamilyActor();
    const body = (await request.json()) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
    const count = await markNotificationsRead(actor, ids);
    return jsonOk({ count });
  });
