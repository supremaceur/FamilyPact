import { type NextRequest } from 'next/server';
import { getRequestContext } from '@/server/auth/context';
import { consumeRateLimit } from '@/server/auth/rate-limit';
import { prisma } from '@/server/db/prisma';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { resolveInvitationCode } from '@/server/services/invitations';
import { suggestChildLoginId } from '@/server/services/accounts';
import { readString } from '@/server/http/parse';

/**
 * Verifie un code d'invitation SANS le consommer, pour afficher le nom de la
 * famille et le type de compte a creer.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const context = await getRequestContext();
    await consumeRateLimit(prisma, 'invitationRedeem', context.ip ?? 'unknown');

    const body = (await request.json()) as { code?: unknown; displayName?: unknown };
    const invitation = await resolveInvitationCode(prisma, readString(body.code));

    return jsonOk({
      familyName: invitation.familyName,
      targetRole: invitation.targetRole,
      expiresAt: invitation.expiresAt.toISOString(),
      suggestedLoginId:
        invitation.targetRole === 'CHILD' && typeof body.displayName === 'string'
          ? await suggestChildLoginId(prisma, body.displayName)
          : null,
    });
  });
