import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import {
  deleteChild,
  updateChildProfile,
  type ChildProfileInput,
} from '@/server/services/children';
import { readString } from '@/server/http/parse';

export const PUT = (
  request: NextRequest,
  context: { params: Promise<{ childMembershipId: string }> },
) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { childMembershipId } = await context.params;
    await updateChildProfile(actor, childMembershipId, (await request.json()) as ChildProfileInput);
    return jsonOk({ ok: true });
  });

/** Effacement definitif du profil enfant et de toutes ses donnees (RGPD). */
export const DELETE = (
  request: NextRequest,
  context: { params: Promise<{ childMembershipId: string }> },
) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { childMembershipId } = await context.params;
    const body = (await request.json()) as { confirmationName?: unknown };
    await deleteChild(actor, childMembershipId, {
      confirmationName: readString(body.confirmationName),
    });
    return jsonOk({ ok: true });
  });
