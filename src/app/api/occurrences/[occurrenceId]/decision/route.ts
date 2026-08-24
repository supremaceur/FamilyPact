import { type NextRequest } from 'next/server';
import { validationError } from '@/domain/errors';
import { requireFamilyActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import {
  approveOccurrence,
  claimOccurrenceDone,
  confirmMissedOccurrence,
  ignoreMissedOccurrence,
  rejectOccurrence,
  rejectOccurrenceWithPenalty,
} from '@/server/services/task-occurrences';

/**
 * Point d'entree unique des transitions d'une occurrence.
 *
 * L'autorisation est portee par le service, pas par la route : `claim` verifie
 * que l'acteur est l'enfant concerne, les autres verifient la permission
 * parentale correspondante. La reponse indique si la decision avait deja ete
 * prise, ce qui permet a l'interface d'afficher un message honnete plutot
 * qu'une erreur en cas de double clic ou de decision concurrente.
 */
export const POST = (
  request: NextRequest,
  context: { params: Promise<{ occurrenceId: string }> },
) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireFamilyActor();
    const { occurrenceId } = await context.params;
    const body = (await request.json()) as { action?: unknown; note?: unknown };
    const note =
      typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null;

    switch (body.action) {
      case 'claim':
        return jsonOk(await claimOccurrenceDone(actor, occurrenceId));
      case 'approve':
        return jsonOk(await approveOccurrence(actor, occurrenceId, note));
      case 'reject':
        return jsonOk(await rejectOccurrence(actor, occurrenceId, note));
      case 'reject-with-penalty':
        return jsonOk(await rejectOccurrenceWithPenalty(actor, occurrenceId, note));
      case 'confirm-missed':
        return jsonOk(await confirmMissedOccurrence(actor, occurrenceId, note));
      case 'ignore-missed':
        return jsonOk(await ignoreMissedOccurrence(actor, occurrenceId, note));
      default:
        throw validationError('Action inconnue.');
    }
  });
