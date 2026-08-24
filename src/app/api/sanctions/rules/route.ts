import { type NextRequest } from 'next/server';
import { requireParentActor } from '@/server/auth/context';
import { assertSameOrigin } from '@/server/http/csrf';
import { jsonCreated, withErrorHandling } from '@/server/http/respond';
import { createSanctionRule, type SanctionRuleInput } from '@/server/services/sanctions';

export const POST = (request: NextRequest) =>
  withErrorHandling(async () => {
    await assertSameOrigin(request.method);
    const actor = await requireParentActor();
    return jsonCreated(
      await createSanctionRule(actor, (await request.json()) as SanctionRuleInput),
    );
  });
