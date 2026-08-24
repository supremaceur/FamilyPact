import { type NextRequest } from 'next/server';
import type { SanctionRuleStatus } from '@/generated/prisma/enums';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import {
  setSanctionRuleStatus,
  updateSanctionRule,
  type SanctionRuleInput,
} from '@/server/services/sanctions';

export const PUT = (request: NextRequest, context: { params: Promise<{ ruleId: string }> }) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { ruleId } = await context.params;
    await updateSanctionRule(actor, ruleId, (await request.json()) as SanctionRuleInput);
    return jsonOk({ ok: true });
  });

export const PATCH = (request: NextRequest, context: { params: Promise<{ ruleId: string }> }) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { ruleId } = await context.params;
    const body = (await request.json()) as { status?: unknown };
    await setSanctionRuleStatus(actor, ruleId, body.status as SanctionRuleStatus);
    return jsonOk({ ok: true });
  });
