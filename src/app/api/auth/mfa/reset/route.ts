import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { clearSessionCookie } from '@/server/auth/session';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { resetOwnMfa } from '@/server/services/mfa';

/**
 * Reinitialise la double authentification.
 * Le compte perd immediatement l'acces : il devra reconfigurer un TOTP.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    await resetOwnMfa(actor);
    await clearSessionCookie();
    return jsonOk({ ok: true });
  });
