import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { readString } from '@/server/http/parse';
import {
  deleteFamily,
  updateFamilySettings,
  type FamilySettingsInput,
} from '@/server/services/family';

export const PUT = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    await updateFamilySettings(actor, (await request.json()) as FamilySettingsInput);
    return jsonOk({ ok: true });
  });

/** Suppression definitive de la famille : proprietaire uniquement, step-up requis. */
export const DELETE = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const body = (await request.json()) as { confirmationName?: unknown };
    await deleteFamily(actor, { confirmationName: readString(body.confirmationName) });
    return jsonOk({ ok: true });
  });
