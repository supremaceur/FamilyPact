import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { revokeInvitation } from '@/server/services/invitations';

export const DELETE = (
  request: NextRequest,
  context: { params: Promise<{ invitationId: string }> },
) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { invitationId } = await context.params;
    await revokeInvitation(actor, invitationId);
    return jsonOk({ ok: true });
  });
