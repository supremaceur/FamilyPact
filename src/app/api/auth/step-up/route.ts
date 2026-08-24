import { type NextRequest } from 'next/server';
import { getRequestContext, requireSession } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { stepUpWithTotp } from '@/server/services/mfa';
import { stepUpWithPasskey } from '@/server/services/passkeys';
import { readString } from '@/server/http/parse';

/**
 * Re-authentification forte avant une operation sensible.
 * Accepte un code TOTP ou une cle d'acces.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const session = await requireSession();
    const context = await getRequestContext();
    const body = (await request.json()) as {
      method?: unknown;
      code?: unknown;
      response?: unknown;
      expectedChallenge?: unknown;
    };

    const elevatedUntil =
      body.method === 'passkey'
        ? await stepUpWithPasskey(
            session,
            {
              response: body.response as Parameters<typeof stepUpWithPasskey>[1]['response'],
              expectedChallenge: readString(body.expectedChallenge),
            },
            context,
          )
        : await stepUpWithTotp(session, readString(body.code), context);

    return jsonOk({ elevatedUntil: elevatedUntil.toISOString() });
  });
