import { type NextRequest } from 'next/server';
import { getCurrentSession } from '@/server/auth/context';
import { clearSessionCookie, revokeSession } from '@/server/auth/session';
import { prisma } from '@/server/db/prisma';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';

/** Deconnexion : la session est revoquee cote serveur, pas seulement oubliee. */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const session = await getCurrentSession();
    if (session !== null) {
      await revokeSession(prisma, session.id, 'user_logout');
    }
    await clearSessionCookie();
    return jsonOk({ ok: true });
  });
