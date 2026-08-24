import { type NextRequest } from 'next/server';
import { getRequestContext } from '@/server/auth/context';
import { setSessionCookie } from '@/server/auth/session';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { login } from '@/server/services/accounts';

/**
 * Connexion par mot de passe.
 *
 * Pour un compte parent, le succes n'ouvre jamais une session complete :
 * `nextStep` indique au client s'il faut configurer ou saisir le second facteur.
 */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const body: unknown = await request.json();
    const context = await getRequestContext();
    const result = await login(body as Parameters<typeof login>[0], context);
    await setSessionCookie(result.session);
    return jsonOk({ nextStep: result.nextStep, userKind: result.userKind });
  });
