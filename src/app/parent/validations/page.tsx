import type { Metadata } from 'next';
import { DecisionCard, ScorePreview } from '@/components/parent/decision-card';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { requireParentActor } from '@/server/auth/context';
import { getPendingDecisions } from '@/server/queries/parent-dashboard';

export const metadata: Metadata = { title: 'Validations' };

/**
 * Decisions en attente sur les taches.
 *
 * Deux sections distinctes, parce que ce sont deux decisions differentes :
 *   - une tache declaree terminee : valider (credit) ou refuser (rien) ;
 *   - une echeance depassee : confirmer le retrait ou l'ignorer.
 *
 * Aucun retrait n'a eu lieu au moment ou cette page s'affiche : le systeme n'a
 * fait que signaler.
 */
const ApprovalsPage = async () => {
  const actor = await requireParentActor();
  const pending = await getPendingDecisions(actor);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card id="taches-terminees">
        <CardHeader
          title="Taches declarees terminees"
          description="Valider credite les points une seule fois, meme si un autre parent valide au meme moment."
        />
        <CardBody className="pt-0">
          {pending.claimed.length === 0 ? (
            <EmptyState title="Aucune tache en attente de validation" />
          ) : (
            <ul>
              {pending.claimed.map((occurrence) => {
                const score = occurrence.child.childProfile?.cachedBalance ?? 0;
                return (
                  <DecisionCard
                    key={occurrence.id}
                    endpoint={`/api/occurrences/${occurrence.id}/decision`}
                    title={occurrence.titleSnapshot}
                    child={{
                      displayName: occurrence.child.user.displayName,
                      avatarKey: occurrence.child.childProfile?.avatarKey ?? 'fox',
                      colorKey: occurrence.child.childProfile?.colorKey ?? 'sage',
                    }}
                    subtitle={
                      <>
                        Declaree terminee le{' '}
                        {occurrence.claimedAt !== null
                          ? formatDateTime(occurrence.claimedAt, actor.timeZone)
                          : '—'}{' '}
                        · echeance {formatDateTime(occurrence.dueAt, actor.timeZone)}
                      </>
                    }
                    options={[
                      {
                        id: 'approve',
                        label: `Valider +${occurrence.pointsAwardSnapshot}`,
                        variant: 'approve',
                        confirmTitle: 'Valider cette tache ?',
                        requiresNote: true,
                        body: { action: 'approve' },
                        consequence: (
                          <>
                            <p>
                              {occurrence.child.user.displayName} recevra{' '}
                              <strong>+{occurrence.pointsAwardSnapshot} points</strong> pour «{' '}
                              {occurrence.titleSnapshot} ».
                            </p>
                            <ScorePreview before={score} delta={occurrence.pointsAwardSnapshot} />
                          </>
                        ),
                      },
                      {
                        id: 'reject',
                        label: 'Refuser',
                        variant: 'secondary',
                        confirmTitle: 'Refuser cette tache ?',
                        requiresNote: true,
                        body: { action: 'reject' },
                        consequence: (
                          <>
                            <p>
                              Aucun point ne sera accorde ni retire. La tache redeviendra « a faire
                              » et {occurrence.child.user.displayName} pourra la declarer a nouveau.
                            </p>
                            <ScorePreview before={score} delta={0} />
                          </>
                        ),
                      },
                      // Le refus avec retrait n'est propose que si la tache a un
                      // retrait configure : sinon il n'aurait rien a retirer, et
                      // un bouton « -0 » n'aurait aucun sens.
                      ...(occurrence.pointsPenaltySnapshot > 0
                        ? [
                            {
                              id: 'reject-with-penalty',
                              label: `Refuser et retirer −${occurrence.pointsPenaltySnapshot}`,
                              variant: 'danger' as const,
                              confirmTitle: 'Refuser et retirer des points ?',
                              requiresNote: true,
                              body: { action: 'reject-with-penalty' },
                              consequence: (
                                <>
                                  <p>
                                    {occurrence.child.user.displayName} perdra{' '}
                                    <strong>−{occurrence.pointsPenaltySnapshot} points</strong> pour
                                    « {occurrence.titleSnapshot} ». La tache redeviendra « a faire
                                    », et le retrait ne pourra pas etre applique une seconde fois
                                    sur cette occurrence.
                                  </p>
                                  <ScorePreview
                                    before={score}
                                    delta={-occurrence.pointsPenaltySnapshot}
                                  />
                                </>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card id="taches-manquees">
        <CardHeader
          title="Taches non realisees"
          description="Le systeme a detecte une echeance depassee. Aucun point n'a ete retire : c'est vous qui decidez."
        />
        <CardBody className="pt-0">
          {pending.missed.length === 0 ? (
            <EmptyState title="Aucune echeance depassee a examiner" />
          ) : (
            <ul>
              {pending.missed.map((occurrence) => {
                const score = occurrence.child.childProfile?.cachedBalance ?? 0;
                return (
                  <DecisionCard
                    key={occurrence.id}
                    endpoint={`/api/occurrences/${occurrence.id}/decision`}
                    title={`${occurrence.titleSnapshot} — non declaree terminee`}
                    child={{
                      displayName: occurrence.child.user.displayName,
                      avatarKey: occurrence.child.childProfile?.avatarKey ?? 'fox',
                      colorKey: occurrence.child.childProfile?.colorKey ?? 'sage',
                    }}
                    subtitle={
                      <>
                        Echeance depassee le {formatDateTime(occurrence.dueAt, actor.timeZone)} ·
                        retrait prevu : −{occurrence.pointsPenaltySnapshot} points
                      </>
                    }
                    options={[
                      {
                        id: 'confirm',
                        label: `Confirmer −${occurrence.pointsPenaltySnapshot}`,
                        variant: 'danger',
                        confirmTitle: 'Confirmer la tache non realisee ?',
                        requiresNote: true,
                        body: { action: 'confirm-missed' },
                        consequence: (
                          <>
                            <p>
                              {occurrence.child.user.displayName} perdra{' '}
                              <strong>{occurrence.pointsPenaltySnapshot} points</strong>.
                            </p>
                            <ScorePreview
                              before={score}
                              delta={-occurrence.pointsPenaltySnapshot}
                            />
                          </>
                        ),
                      },
                      {
                        id: 'ignore',
                        label: 'Ignorer',
                        variant: 'secondary',
                        confirmTitle: 'Ignorer cette tache non realisee ?',
                        body: { action: 'ignore-missed' },
                        consequence: (
                          <>
                            <p>
                              Aucun point ne sera retire. La decision restera visible dans
                              l&apos;historique.
                            </p>
                            <ScorePreview before={score} delta={0} />
                          </>
                        ),
                      },
                    ]}
                  />
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default ApprovalsPage;
