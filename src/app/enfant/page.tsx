import type { Metadata } from 'next';
import Link from 'next/link';
import { ClaimTaskButton } from '@/components/child/claim-task-button';
import { SummaryStrip } from '@/components/child/summary-strip';
import { DashboardColumn, DashboardGrid, PageBody } from '@/components/layout/page-body';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar, ProgressRing } from '@/components/ui/progress';
import { TASK_STATE_LABELS } from '@/domain/tasks';
import { formatDateTime, formatTime } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getChildDashboard } from '@/server/queries/child-dashboard';

export const metadata: Metadata = { title: 'Mon espace' };

/**
 * Tableau de bord enfant.
 *
 * Beaucoup plus simple que l'espace parent : le score, la prochaine
 * recompense, les taches du jour, les sanctions en cours. Rien d'autre.
 *
 * Aucune mecanique de jeu : la barre de progression est une information, pas
 * une recompense visuelle. Aucun badge, aucun niveau, aucune serie.
 *
 * LARGEUR VOLONTAIREMENT PLUS COURTE QUE COTE PARENT. Un enfant n'a pas a
 * balayer 1300 px pour savoir ce qu'il doit faire : la colonne de gauche porte
 * ce qui le concerne — son score, ses taches — et la droite ce qui attend
 * quelqu'un d'autre.
 */
const ChildDashboardPage = async () => {
  const actor = await requireChildActor();
  const data = await getChildDashboard(actor);

  const aQuelqueChoseADroite = data.activeSanctions.length > 0 || data.pendingTasks.length > 0;

  return (
    <PageBody largeur="liste" className="flex flex-col gap-5">
      <SummaryStrip
        reperes={[
          {
            cle: 'faire',
            libelle: 'A faire',
            valeur: data.todayTasks.length,
            href: '/enfant/taches',
            precision: data.todayTasks.length > 1 ? 'taches' : 'tache',
          },
          {
            cle: 'attente',
            libelle: "En attente d'un parent",
            valeur: data.pendingTasks.length,
            href: '/enfant/taches',
            precision: data.pendingTasks.length > 1 ? 'transmises' : 'transmise',
          },
          {
            cle: 'encours',
            libelle: 'Sanctions en cours',
            valeur: data.activeSanctions.length,
            href: '/enfant/sanctions',
            precision: data.activeSanctions.length > 1 ? 'en cours' : 'en cours',
          },
        ]}
      />

      <DashboardGrid>
        <DashboardColumn>
          {/* HALO — l'anneau est la piece centrale de l'espace enfant. Le score
              reste ecrit en grand au centre, et le rappel chiffre le suit
              toujours : un arc de cercle ne dit pas « combien il me reste ». */}
          <Card>
            <CardBody className="pt-6 text-center">
              {data.nextReward === null ? (
                <>
                  <p className="text-sm text-[var(--text-muted)]">Mon score</p>
                  <p className="tabular mt-1 text-5xl font-semibold">{data.score}</p>
                  <p className="text-sm text-[var(--text-muted)]">points</p>
                  <p className="mt-6 text-sm text-[var(--text-muted)]">
                    Aucune recompense n&apos;est prevue pour l&apos;instant.
                  </p>
                </>
              ) : (
                <>
                  <ProgressRing
                    value={data.score}
                    max={data.nextReward.threshold}
                    label={`Progression vers ${data.nextReward.title}`}
                    centre={data.score}
                    legende="points"
                  />
                  <p className="mt-4 font-medium">{data.nextReward.title}</p>
                  <div className="tabular mt-1 flex items-baseline justify-center gap-2 text-sm">
                    <span className="text-[var(--text-muted)]">
                      {data.score} / {data.nextReward.threshold}
                    </span>
                    <span aria-hidden="true" className="text-[var(--text-muted)]">
                      ·
                    </span>
                    <span className="font-medium">
                      {data.nextReward.remaining === 0
                        ? 'Palier atteint'
                        : `${data.nextReward.remaining} point${data.nextReward.remaining > 1 ? 's' : ''} restant${data.nextReward.remaining > 1 ? 's' : ''}`}
                    </span>
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          {/* Le lisere ne s'allume que s'il y a effectivement quelque chose a
              faire : un accent permanent cesse d'attirer l'oeil. */}
          <Card tone={data.todayTasks.length > 0 ? 'lead' : 'default'}>
            <CardHeader title="A faire" />
            <CardBody className="pt-0">
              {data.todayTasks.length === 0 ? (
                <EmptyState title="Rien a faire pour le moment" description="Profite bien !" />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.todayTasks.map((task) => (
                    <li key={task.id} className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">{task.title}</p>
                          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                            Avant {formatTime(task.dueAt, actor.timeZone)}
                          </p>
                        </div>
                        <span className="tabular text-leaf-700 dark:text-leaf-200 shrink-0 text-sm font-semibold">
                          +{task.pointsAward}
                        </span>
                      </div>
                      <ClaimTaskButton occurrenceId={task.id} points={task.pointsAward} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </DashboardColumn>

        <DashboardColumn>
          {data.activeSanctions.length > 0 && (
            <Card>
              <CardHeader title="Sanctions en cours" />
              <CardBody className="pt-0">
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.activeSanctions.map((sanction) => (
                    <li key={sanction.id} className="py-3">
                      <p className="text-sm font-medium">{sanction.title}</p>
                      {sanction.description !== null && (
                        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                          {sanction.description}
                        </p>
                      )}
                      {sanction.liftScoreThreshold !== null && (
                        <div className="mt-2">
                          <div className="tabular flex items-baseline justify-between text-xs">
                            <span className="text-[var(--text-muted)]">
                              Pour que ca s&apos;arrete
                            </span>
                            <span className="text-[var(--text-muted)]">
                              {data.score} / {sanction.liftScoreThreshold}
                            </span>
                          </div>
                          <ProgressBar
                            className="mt-1"
                            value={data.score}
                            max={sanction.liftScoreThreshold}
                            label={`Progression vers la fin de ${sanction.title}`}
                          />
                        </div>
                      )}
                      {sanction.liftAt !== null && (
                        <p className="mt-2 text-xs text-[var(--text-muted)]">
                          Fin prevue : {formatDateTime(sanction.liftAt, actor.timeZone)}
                        </p>
                      )}
                      {sanction.status === 'LIFT_ELIGIBLE' && (
                        <p className="text-amber-soft-700 dark:text-amber-soft-200 mt-2 text-xs">
                          La condition est atteinte. Un parent doit encore lever la sanction.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {data.pendingTasks.length > 0 && (
            <Card>
              <CardHeader
                title="En attente d'un parent"
                description="Ces taches ont ete transmises. Les points arriveront apres validation."
              />
              <CardBody className="pt-0">
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {data.pendingTasks.map((task) => (
                    <li key={task.id} className="flex items-center justify-between gap-3 py-3">
                      <span className="min-w-0 truncate text-sm">{task.title}</span>
                      <Badge tone="pending">{TASK_STATE_LABELS[task.state]}</Badge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* Sans sanction ni tache en attente, la colonne droite serait vide.
              Plutot que de la meubler, on y met le seul lien qui a du sens ici. */}
          <Card>
            <CardHeader
              title="Mon historique"
              description="Tout ce qui a fait bouger mes points, et les decisions qui n'en ont pas fait bouger."
            />
            <CardBody className="pt-0">
              <Link
                href="/enfant/points"
                className="text-pact-700 dark:text-pact-300 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4"
              >
                {aQuelqueChoseADroite
                  ? 'Voir mon historique'
                  : 'Voir tout mon historique de points'}
              </Link>
            </CardBody>
          </Card>
        </DashboardColumn>
      </DashboardGrid>
    </PageBody>
  );
};

export default ChildDashboardPage;
