import { type NextRequest } from 'next/server';
import { getRequestContext } from '@/server/auth/context';
import { setSessionCookie } from '@/server/auth/session';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { registerInvitedChild } from '@/server/services/accounts';

/** Creation d'un compte enfant a partir d'un code d'invitation CHILD. */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const body: unknown = await request.json();
    const context = await getRequestContext();
    const result = await registerInvitedChild(
      body as Parameters<typeof registerInvitedChild>[0],
      context,
    );
    await setSessionCookie(result.session);
    return jsonCreated({ nextStep: 'READY' as const });
  });
