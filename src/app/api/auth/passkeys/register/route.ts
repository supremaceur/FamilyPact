import { type NextRequest } from 'next/server';
import { getRequestContext, requireSession } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, jsonOk, withErrorHandling } from '@/server/http/respond';
import { beginPasskeyRegistration, finishPasskeyRegistration } from '@/server/services/passkeys';
import { readString } from '@/server/http/parse';

/** Options d'enregistrement WebAuthn (authentificateur de plateforme). */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const session = await requireSession();
    const options = await beginPasskeyRegistration(session);
    return jsonCreated(options);
  });

/** Verification de la reponse du navigateur et enregistrement de la cle. */
export const PUT = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const session = await requireSession();
    const context = await getRequestContext();
    const body = (await request.json()) as {
      response?: unknown;
      expectedChallenge?: unknown;
      nickname?: unknown;
    };
    const created = await finishPasskeyRegistration(
      session,
      {
        response: body.response as Parameters<typeof finishPasskeyRegistration>[1]['response'],
        expectedChallenge: readString(body.expectedChallenge),
        nickname: readString(body.nickname),
      },
      context,
    );
    return jsonOk(created);
  });
