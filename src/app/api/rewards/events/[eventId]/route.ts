import { type NextRequest } from 'next/server';
import { validationError } from '@/domain/errors';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { grantReward, ignoreReward } from '@/server/services/rewards';

/**
 * Decision parentale sur une recompense proposee.
 * Le systeme ne l'accorde jamais seul : seule cette route la rend effective.
 */
export const POST = (request: NextRequest, context: { params: Promise<{ eventId: string }> }) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { eventId } = await context.params;
    const body = (await request.json()) as { action?: unknown; note?: unknown };
    const note =
      typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null;

    if (body.action === 'grant') return jsonOk(await grantReward(actor, eventId, note));
    if (body.action === 'ignore') return jsonOk(await ignoreReward(actor, eventId, note));
    throw validationError('Action inconnue.');
  });
