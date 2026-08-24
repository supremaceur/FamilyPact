import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { reversePointTransaction, type ReversalInput } from '@/server/services/point-adjustments';

/**
 * Annulation d'une transaction : ajoute une ecriture inverse.
 * L'ecriture d'origine reste visible dans l'historique.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const result = await reversePointTransaction(actor, (await request.json()) as ReversalInput);
    return jsonCreated(result);
  });
