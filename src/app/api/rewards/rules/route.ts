import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { createRewardRule, type RewardRuleInput } from '@/server/services/rewards';

export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    return jsonCreated(await createRewardRule(actor, (await request.json()) as RewardRuleInput));
  });
