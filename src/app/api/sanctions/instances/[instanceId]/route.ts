import { type NextRequest } from 'next/server';
import { validationError } from '@/domain/errors';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import {
  activateSanction,
  ignoreSanction,
  liftSanction,
  type ActivationInput,
} from '@/server/services/sanctions';

/**
 * Decisions parentales sur une sanction.
 *
 * Rien n'est automatique : une sanction proposee reste sans effet tant qu'un
 * parent ne l'active pas, et une condition de levee atteinte ne leve rien tant
 * qu'un parent ne le decide pas.
 */
export const POST = (request: NextRequest, context: { params: Promise<{ instanceId: string }> }) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { instanceId } = await context.params;
    const body = (await request.json()) as {
      action?: unknown;
      note?: unknown;
      activation?: unknown;
    };
    const note =
      typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null;

    switch (body.action) {
      case 'activate':
        return jsonOk(
          await activateSanction(actor, instanceId, body.activation as ActivationInput),
        );
      case 'ignore':
        return jsonOk(await ignoreSanction(actor, instanceId));
      case 'lift':
        return jsonOk(await liftSanction(actor, instanceId, note));
      default:
        throw validationError('Action inconnue.');
    }
  });
