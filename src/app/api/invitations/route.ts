import { type NextRequest } from 'next/server';
import { getEnv } from '@/lib/env';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { createInvitation, type InvitationInput } from '@/server/services/invitations';

/**
 * Cree une invitation. Le code en clair n'est renvoye qu'ici, une seule fois :
 * seul son hash est conserve en base.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const invitation = await createInvitation(
      actor,
      (await request.json()) as InvitationInput,
      getEnv().APP_ORIGIN,
    );
    return jsonCreated({
      id: invitation.id,
      formattedCode: invitation.formattedCode,
      joinUrl: invitation.joinUrl,
      targetRole: invitation.targetRole,
      expiresAt: invitation.expiresAt.toISOString(),
    });
  });
