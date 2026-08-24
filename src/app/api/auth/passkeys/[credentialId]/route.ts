import { type NextRequest } from 'next/server';
import { getRequestContext, requireSession } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { removePasskey } from '@/server/services/passkeys';

/** Suppression d'une cle d'acces : operation sensible, step-up requis. */
export const DELETE = (
  request: NextRequest,
  context: { params: Promise<{ credentialId: string }> },
) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const session = await requireSession();
    const { credentialId } = await context.params;
    await removePasskey(session, credentialId, await getRequestContext());
    return jsonOk({ ok: true });
  });
