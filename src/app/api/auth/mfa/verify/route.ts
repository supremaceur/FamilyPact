import { type NextRequest } from 'next/server';
import { getRequestContext, requireSession } from '@/server/auth/context';
import { setSessionCookie } from '@/server/auth/session';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { verifyRecoveryCodeForSession, verifyTotpForSession } from '@/server/services/mfa';
import { readString } from '@/server/http/parse';

/**
 * Verification du second facteur pour une session en attente.
 * Accepte un code TOTP ou, en dernier recours, un code de recuperation.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const session = await requireSession();
    const body = (await request.json()) as { code?: unknown; method?: unknown };
    const context = await getRequestContext();

    const issued =
      body.method === 'recovery'
        ? await verifyRecoveryCodeForSession(session, readString(body.code), context)
        : await verifyTotpForSession(session, readString(body.code), context);

    await setSessionCookie(issued);
    return jsonOk({ ok: true });
  });
