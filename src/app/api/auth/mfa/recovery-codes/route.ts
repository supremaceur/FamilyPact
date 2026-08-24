import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { regenerateRecoveryCodes } from '@/server/services/mfa';

/** Regeneration des codes de secours : operation sensible, step-up requis. */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const codes = await regenerateRecoveryCodes(actor);
    return jsonOk({ recoveryCodes: codes });
  });
