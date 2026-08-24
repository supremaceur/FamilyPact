import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { adjustPoints, type AdjustmentInput } from '@/server/services/point-adjustments';

/** Ajustement manuel. Le motif est obligatoire, valide cote serveur. */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const result = await adjustPoints(actor, (await request.json()) as AdjustmentInput);
    return jsonCreated(result);
  });
