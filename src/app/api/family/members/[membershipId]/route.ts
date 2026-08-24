import { type NextRequest } from 'next/server';
import type { FamilyRole } from '@/generated/prisma/enums';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import { changeMemberRole, removeMember } from '@/server/services/family';

export const PATCH = (
  request: NextRequest,
  context: { params: Promise<{ membershipId: string }> },
) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { membershipId } = await context.params;
    const body = (await request.json()) as { role?: unknown };
    await changeMemberRole(actor, {
      membershipId,
      role: body.role as FamilyRole & ('ADMIN' | 'PARENT'),
    });
    return jsonOk({ ok: true });
  });

export const DELETE = (
  request: NextRequest,
  context: { params: Promise<{ membershipId: string }> },
) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { membershipId } = await context.params;
    await removeMember(actor, membershipId);
    return jsonOk({ ok: true });
  });
