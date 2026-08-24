import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { transferOwnership } from '@/server/services/family';
import { readString } from '@/server/http/parse';

/** Transfert de propriete : proprietaire uniquement, step-up requis. */
export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const body = (await request.json()) as { membershipId?: unknown };
    await transferOwnership(actor, readString(body.membershipId));
    return jsonOk({ ok: true });
  });
