import type { Metadata } from 'next';
import { RewardEventStatus } from '@/generated/prisma/enums';
import { DecisionCard } from '@/components/parent/decision-card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { requireParentActor } from '@/server/auth/context';
import { listRewardEvents } from '@/server/queries/parent-lists';

export const metadata: Metadata = { title: 'Recompenses' };

/**
 * Recompenses proposees et obtenues.
 *
 * Rappel affiche a l'ecran : une recompense validee reste acquise meme si le
 * score redescend, et un palier ne consomme aucun point.
 */
const RewardsPage = async () => {
  const actor = await requireParentActor();
  const events = await listRewardEvents(actor);

  const pending = events.filter(
    (event) => event.status === RewardEventStatus.PENDING_PARENT_APPROVAL,
  );
  const decided = events.filter(
    (event) => event.status !== RewardEventStatus.PENDING_PARENT_APPROVAL,
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader
          title="Recompenses proposees"
          description="Le systeme signale un palier atteint. Il n'accorde jamais la recompense lui-meme."
        />
        <CardBody className="pt-0">
          {pending.length === 0 ? (
            <EmptyState title="Aucune recompense en attente de validation" />
          ) : (
            <ul>
              {pending.map((event) => (
                <DecisionCard
                  key={event.id}
                  endpoint={`/api/rewards/events/${event.id}`}
                  title={event.titleSnapshot}
                  child={{
                    displayName: event.child.user.displayName,
                    avatarKey: event.child.childProfile?.avatarKey ?? 'fox',
                    colorKey: event.child.childProfile?.colorKey ?? 'sage',
                  }}
                  subtitle={
                    <>
                      Palier de {event.thresholdSnapshot} points atteint le{' '}
                      {formatDateTime(event.proposedAt, actor.timeZone)} (score :{' '}
                      {event.scoreAtProposal})
                    </>
                  }
                  options={[
                    {
                      id: 'grant',
                      label: 'Valider la recompense',
                      variant: 'approve',
                      confirmTitle: 'Valider cette recompense ?',
                      requiresNote: true,
                      body: { action: 'grant' },
                      consequence: (
                        <>
                          <p>
                            « {event.titleSnapshot} » apparaitra comme obtenue pour{' '}
                            {event.child.user.displayName}.
                          </p>
                          <p className="mt-2 text-[var(--text-muted)]">
                            Aucun point n&apos;est consomme : le score reste a{' '}
                            {event.child.childProfile?.cachedBalance ?? 0}. La recompense reste
                            acquise meme si le score redescend ensuite.
                          </p>
                        </>
                      ),
                    },
                    {
                      id: 'ignore',
                      label: 'Ignorer',
                      variant: 'secondary',
                      confirmTitle: 'Ignorer cette recompense ?',
                      body: { action: 'ignore' },
                      consequence: (
                        <p>
                          Ce palier ne sera plus propose : chaque palier n&apos;est propose
                          qu&apos;une seule fois par enfant. Vous pourrez creer un nouveau palier si
                          besoin.
                        </p>
                      ),
                    },
                  ]}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Historique des paliers" />
        <CardBody className="pt-0">
          {decided.length === 0 ? (
            <EmptyState title="Aucune decision enregistree pour le moment" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {decided.map((event) => (
                <li key={event.id} className="flex items-start gap-3 py-3">
                  <Avatar
                    avatarKey={event.child.childProfile?.avatarKey ?? 'fox'}
                    colorKey={event.child.childProfile?.colorKey ?? 'sage'}
                    name={event.child.user.displayName}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{event.titleSnapshot}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {event.child.user.displayName} · palier {event.thresholdSnapshot} points
                      {event.decidedBy !== null && <> · {event.decidedBy.user.displayName}</>}
                      {event.decidedAt !== null && (
                        <> · {formatDateTime(event.decidedAt, actor.timeZone)}</>
                      )}
                    </p>
                  </div>
                  <Badge tone={event.status === RewardEventStatus.GRANTED ? 'positive' : 'neutral'}>
                    {event.status === RewardEventStatus.GRANTED ? 'Obtenue' : 'Ignoree'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default RewardsPage;
