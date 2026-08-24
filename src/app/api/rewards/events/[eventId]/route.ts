import { type NextRequest } from 'next/server';
import { validationError } from '@/domain/errors';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { grantReward, ignoreReward, keepReward, revokeReward } from '@/server/services/rewards';

/**
 * Decision parentale sur une recompense.
 *
 * Quatre actions, toutes explicites : accorder, ignorer la proposition, retirer
 * une recompense qui durait, ou la laisser malgre un score redescendu. Le
 * systeme n'en declenche aucune seul.
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
    if (body.action === 'keep') return jsonOk(await keepReward(actor, eventId, note));
    if (body.action === 'revoke') {
      // Le motif est obligatoire : le service le revalide, mais un message clair
      // vaut mieux ici qu'une erreur venue de deux couches plus bas.
      if (note === null) throw validationError('Indiquez pourquoi la recompense est retiree.');
      return jsonOk(await revokeReward(actor, eventId, note));
    }
    throw validationError('Action inconnue.');
  });
