import { type NextRequest } from 'next/server';
import { getRequestContext } from '@/server/auth/context';
import { setSessionCookie } from '@/server/auth/session';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { registerInvitedParent } from '@/server/services/accounts';

/**
 * Creation d'un compte parent invite.
 * Le role provient du jeton, jamais de la requete. Les privileges ne sont
 * effectifs qu'une fois la double authentification configuree.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const body: unknown = await request.json();
    const context = await getRequestContext();
    const result = await registerInvitedParent(
      body as Parameters<typeof registerInvitedParent>[0],
      context,
    );
    await setSessionCookie(result.session);
    return jsonCreated({ nextStep: 'MFA_ENROLLMENT' as const });
  });
