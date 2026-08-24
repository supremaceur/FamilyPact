import { type NextRequest } from 'next/server';
import { getRequestContext } from '@/server/auth/context';
import { setSessionCookie } from '@/server/auth/session';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, jsonOk, withErrorHandling } from '@/server/http/respond';
import { beginPasskeyAuthentication, loginWithPasskey } from '@/server/services/passkeys';
import { readString } from '@/server/http/parse';

/**
 * Defi d'authentification WebAuthn.
 * Un defi est toujours emis, meme pour un identifiant inconnu : l'existence
 * d'un compte ne doit pas etre observable.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const body = (await request.json()) as { identifier?: unknown };
    const options = await beginPasskeyAuthentication(
      typeof body.identifier === 'string' ? body.identifier : null,
    );
    return jsonCreated(options);
  });

/** Verification de la signature et ouverture d'une session complete. */
export const PUT = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const context = await getRequestContext();
    const body = (await request.json()) as { response?: unknown; expectedChallenge?: unknown };
    const result = await loginWithPasskey(
      {
        response: body.response as Parameters<typeof loginWithPasskey>[0]['response'],
        expectedChallenge: readString(body.expectedChallenge),
      },
      context,
    );
    await setSessionCookie(result.session);
    return jsonOk({ userKind: result.userKind, nextStep: 'READY' as const });
  });
