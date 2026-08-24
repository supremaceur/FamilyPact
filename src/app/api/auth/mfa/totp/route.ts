import { type NextRequest } from 'next/server';
import { getRequestContext, requireSession } from '@/server/auth/context';
import { setSessionCookie } from '@/server/auth/session';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, jsonOk, withErrorHandling } from '@/server/http/respond';
import { beginTotpEnrollment, confirmTotpEnrollment } from '@/server/services/mfa';
import { readString } from '@/server/http/parse';

/** Genere un secret TOTP et son QR code. Le secret reste non confirme. */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const session = await requireSession();
    const challenge = await beginTotpEnrollment(session);
    return jsonCreated({
      otpauthUrl: challenge.otpauthUrl,
      secretBase32: challenge.secretBase32,
      qrCodeSvg: challenge.qrCodeSvg,
    });
  });

/** Confirme l'enrolement et emet les codes de recuperation. */
export const PUT = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const session = await requireSession();
    const body = (await request.json()) as { code?: unknown };
    const context = await getRequestContext();
    const result = await confirmTotpEnrollment(session, readString(body.code), context);
    await setSessionCookie(result.session);
    // Les codes en clair ne sont renvoyes qu'ici, une seule fois.
    return jsonOk({ recoveryCodes: result.recoveryCodes });
  });
