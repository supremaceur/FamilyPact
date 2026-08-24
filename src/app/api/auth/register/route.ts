import { type NextRequest } from 'next/server';
import { getRequestContext } from '@/server/auth/context';
import { setSessionCookie } from '@/server/auth/session';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { registerParentAndFamily } from '@/server/services/accounts';

/**
 * Creation d'un compte proprietaire et de sa famille.
 * La session ouverte est en attente d'enrolement MFA : elle ne donne acces a
 * aucune donnee familiale.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const body: unknown = await request.json();
    const context = await getRequestContext();
    const result = await registerParentAndFamily(
      body as Parameters<typeof registerParentAndFamily>[0],
      context,
    );
    await setSessionCookie(result.session);
    return jsonCreated({ nextStep: 'MFA_ENROLLMENT' as const });
  });
