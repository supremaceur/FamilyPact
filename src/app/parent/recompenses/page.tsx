import type { Metadata } from 'next';
import { DashboardColumn, DashboardGrid, PageBody } from '@/components/layout/page-body';
import { RewardEventStatus } from '@/generated/prisma/enums';
import { DecisionCard } from '@/components/parent/decision-card';
import { RewardRevokeButton } from '@/components/parent/reward-revoke-button';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { requireParentActor } from '@/server/auth/context';
import { listRewardEvents, listRewardRevocationSuggestions } from '@/server/queries/parent-lists';

export const metadata: Metadata = { title: 'Recompenses' };

const STATUT_LABEL: Readonly<Record<RewardEventStatus, string>> = {
  PENDING_PARENT_APPROVAL: 'Proposee',
  GRANTED: 'Obtenue',
  IGNORED: 'Ignoree',
  REVOKED: 'Retiree',
};

const STATUT_TON: Readonly<
  Record<RewardEventStatus, 'positive' | 'neutral' | 'negative' | 'pending'>
> = {
  PENDING_PARENT_APPROVAL: 'pending',
  GRANTED: 'positive',
  IGNORED: 'neutral',
  REVOKED: 'negative',
};

/**
 * Recompenses proposees, a revoir, et obtenues.
 *
 * Deux natures de recompense cohabitent, et l'ecran doit les distinguer :
 * une recompense PONCTUELLE, une fois accordee, ne se retire pas — l'ecran ne
 * propose meme pas de le faire. Une recompense QUI DURE peut etre retiree si le
 * score repasse sous le palier ; l'application le signale, le parent tranche,
 * et laisser est une reponse aussi normale que retirer.
 *
 * Un palier ne consomme aucun point, et son retrait n'en rend aucun.
 */
const RewardsPage = async () => {
  const actor = await requireParentActor();
  const [events, aRevoir] = await Promise.all([
    listRewardEvents(actor),
    listRewardRevocationSuggestions(actor),
  ]);

  const pending = events.filter(
    (event) => event.status === RewardEventStatus.PENDING_PARENT_APPROVAL,
  );
  const decided = events.filter(
    (event) => event.status !== RewardEventStatus.PENDING_PARENT_APPROVAL,
  );

  return (
    <PageBody largeur="tableauDeBord">
      <DashboardGrid>
        <DashboardColumn>
          {/* Le lisere signale une file d'attente non vide. Vide, la carte
              redevient une carte comme les autres. */}
          <Card tone={pending.length > 0 ? 'lead' : 'default'}>
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
                              qu&apos;une seule fois par enfant. Vous pourrez creer un nouveau
                              palier si besoin.
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

          {/* Le lisere ne s'allume que si une recompense attend un arbitrage :
              proposer un retrait en permanence pousserait a en prendre un. */}
          <Card tone={aRevoir.length > 0 ? 'lead' : 'default'}>
            <CardHeader
              title="Recompenses a revoir"
              description="Le score est repasse sous le palier. Retirer ou laisser : les deux reponses sont normales, et aucune ne touche aux points."
            />
            <CardBody className="pt-0">
              {aRevoir.length === 0 ? (
                <EmptyState title="Aucune recompense a revoir" />
              ) : (
                <ul>
                  {aRevoir.map((reward) => (
                    <DecisionCard
                      key={reward.id}
                      endpoint={`/api/rewards/events/${reward.id}`}
                      title={reward.title}
                      child={{
                        displayName: reward.childName,
                        avatarKey: reward.avatarKey,
                        colorKey: reward.colorKey,
                      }}
                      subtitle={
                        <>
                          Obtenue au palier de {reward.threshold} points
                          {reward.grantedAt !== null && (
                            <> le {formatDateTime(reward.grantedAt, actor.timeZone)}</>
                          )}{' '}
                          — score actuel : {reward.score}
                        </>
                      }
                      options={[
                        {
                          id: 'keep',
                          label: 'Laisser',
                          variant: 'secondary',
                          confirmTitle: 'Laisser cette recompense ?',
                          body: { action: 'keep' },
                          consequence: (
                            <>
                              <p>
                                {reward.childName} garde «&nbsp;{reward.title}&nbsp;». Rien ne
                                change.
                              </p>
                              <p className="mt-2 text-[var(--text-muted)]">
                                La question ne sera plus posee pour cette recompense. Vous pourrez
                                toujours la retirer plus tard depuis l&apos;historique.
                              </p>
                            </>
                          ),
                        },
                        {
                          id: 'revoke',
                          label: 'Retirer la recompense',
                          variant: 'danger',
                          confirmTitle: 'Retirer cette recompense ?',
                          requiresNote: true,
                          noteMandatory: true,
                          body: { action: 'revoke' },
                          consequence: (
                            <>
                              <p>
                                {reward.childName} perd «&nbsp;{reward.title}&nbsp;». Le motif que
                                vous indiquez lui sera montre.
                              </p>
                              <p className="mt-2 text-[var(--text-muted)]">
                                Aucun point n&apos;est retire ni rendu : le score reste a{' '}
                                {reward.score}. Le palier ne sera pas repropose.
                              </p>
                            </>
                          ),
                        },
                      ]}
                    />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </DashboardColumn>

        <DashboardColumn>
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
                        {event.status === RewardEventStatus.REVOKED && (
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            Retiree
                            {event.revokedBy !== null && (
                              <> par {event.revokedBy.user.displayName}</>
                            )}
                            {event.revokedAt !== null && (
                              <> le {formatDateTime(event.revokedAt, actor.timeZone)}</>
                            )}
                            {event.revocationReason !== null && <> — {event.revocationReason}</>}
                          </p>
                        )}
                        {/* Le retrait reste possible sans attendre que le score
                            redescende : un parent n'a pas a justifier sa decision
                            par un chiffre. La suggestion ne fait que signaler. */}
                        {event.status === RewardEventStatus.GRANTED &&
                          event.rewardRule.revocable && (
                            <RewardRevokeButton
                              rewardEventId={event.id}
                              title={event.titleSnapshot}
                              childName={event.child.user.displayName}
                              score={event.child.childProfile?.cachedBalance ?? 0}
                            />
                          )}
                      </div>
                      <Badge tone={STATUT_TON[event.status]}>{STATUT_LABEL[event.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </DashboardColumn>
      </DashboardGrid>
    </PageBody>
  );
};

export default RewardsPage;
