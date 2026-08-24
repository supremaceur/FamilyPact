import { type NextRequest } from 'next/server';
import type { RewardRuleStatus } from '@/generated/prisma/enums';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonOk, withErrorHandling } from '@/server/http/respond';
import {
  setRewardRuleStatus,
  updateRewardRule,
  type RewardRuleInput,
} from '@/server/services/rewards';

export const PUT = (request: NextRequest, context: { params: Promise<{ ruleId: string }> }) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { ruleId } = await context.params;
    await updateRewardRule(actor, ruleId, (await request.json()) as RewardRuleInput);
    return jsonOk({ ok: true });
  });

export const PATCH = (request: NextRequest, context: { params: Promise<{ ruleId: string }> }) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    const { ruleId } = await context.params;
    const body = (await request.json()) as { status?: unknown };
    await setRewardRuleStatus(actor, ruleId, body.status as RewardRuleStatus);
    return jsonOk({ ok: true });
  });
