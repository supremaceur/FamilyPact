import type { Metadata } from 'next';
import { DashboardColumn, DashboardGrid, PageBody } from '@/components/layout/page-body';
import { ParentPermission, TaskOccurrenceState } from '@/generated/prisma/enums';
import { ChildProfileForm } from '@/components/parent/child-profile-form';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ProgressBar } from '@/components/ui/progress';
import { nextRewardProgress } from '@/domain/rules-engine';
import { formatDate, formatDateTime } from '@/lib/format';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';
import { getChildDetail } from '@/server/queries/parent-lists';

export const metadata: Metadata = { title: 'Fiche enfant' };

/**
 * Fiche detaillee d'un enfant.
 *
 * L'identifiant vient de l'URL, mais la requete est toujours filtree par la
 * famille de l'acteur : un identifiant appartenant a une autre famille produit
 * un 404, jamais des donnees.
 */
const ChildDetailPage = async ({
  params,
}: {
  readonly params: Promise<{ childMembershipId: string }>;
}) => {
  const actor = await requireParentActor();
  const { childMembershipId } = await params;
  const child = await getChildDetail(actor, childMembershipId);
  const score = child.childProfile?.cachedBalance ?? 0;

  const [rewardRules, rewardEvents, recentOccurrences, activeSanctions] = await Promise.all([
    prisma.rewardRule.findMany({
      where: { familyId: actor.familyId, childMembershipId, status: 'ACTIVE' },
      select: { id: true, title: true, threshold: true, status: true },
    }),
    prisma.rewardEvent.findMany({
      where: { familyId: actor.familyId, childMembershipId },
      select: { rewardRuleId: true, status: true },
    }),
    prisma.taskOccurrence.findMany({
      where: { familyId: actor.familyId, childMembershipId },
      orderBy: { dueAt: 'desc' },
      take: 15,
      select: {
        id: true,
        titleSnapshot: true,
        state: true,
        dueAt: true,
        pointsAwardSnapshot: true,
        pointsPenaltySnapshot: true,
      },
    }),
    prisma.sanctionInstance.findMany({
      where: {
        familyId: actor.familyId,
        childMembershipId,
        status: { in: ['ACTIVE', 'LIFT_ELIGIBLE'] },
      },
      select: {
        id: true,
        titleSnapshot: true,
        status: true,
        liftAt: true,
        liftScoreThreshold: true,
      },
    }),
  ]);

  const eventByRule = new Map(rewardEvents.map((event) => [event.rewardRuleId, event.status]));
  const nextReward = nextRewardProgress(
    score,
    rewardRules.map((rule) => ({
      id: rule.id,
      title: rule.title,
      threshold: rule.threshold,
      status: rule.status,
      eventStatus: eventByRule.get(rule.id) ?? null,
    })),
  );

  return (
    <PageBody largeur="tableauDeBord" className="flex flex-col gap-5">
      <Card>
        <CardBody className="pt-5">
          <p className="text-sm text-[var(--text-muted)]">{child.user.displayName}</p>
          <p className="tabular mt-1 text-4xl font-semibold">
            {score}
            <span className="ml-2 text-base font-normal text-[var(--text-muted)]">points</span>
          </p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Identifiant de connexion : {child.user.loginId ?? '—'} · membre depuis le{' '}
            {formatDate(child.joinedAt, actor.timeZone)}
            {child.user.lastLoginAt !== null && (
              <> · derniere connexion {formatDateTime(child.user.lastLoginAt, actor.timeZone)}</>
            )}
          </p>

          {nextReward !== null && (
            <div className="mt-5">
              <div className="tabular flex items-baseline justify-between gap-3 text-sm">
                <span className="text-[var(--text-secondary)]">
                  Prochaine recompense : {nextReward.title}
                </span>
                <span className="text-[var(--text-muted)]">
                  {score} / {nextReward.threshold}
                </span>
              </div>
              <ProgressBar
                className="mt-2"
                value={score}
                max={nextReward.threshold}
                label={`Progression de ${child.user.displayName}`}
              />
            </div>
          )}
        </CardBody>
      </Card>

      <DashboardGrid>
        {/* A gauche ce que l'enfant a fait, a droite ce qui le concerne
            en ce moment et le reglage de son profil. */}
        <DashboardColumn>
          <Card>
            <CardHeader title="Taches recentes" />
            <CardBody className="pt-0">
              {recentOccurrences.length === 0 ? (
                <EmptyState title="Aucune tache pour le moment" />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {recentOccurrences.map((occurrence) => (
                    <li
                      key={occurrence.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{occurrence.titleSnapshot}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {formatDateTime(occurrence.dueAt, actor.timeZone)}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-[var(--text-muted)]">
                        {occurrence.state === TaskOccurrenceState.APPROVED
                          ? `+${occurrence.pointsAwardSnapshot}`
                          : occurrence.state === TaskOccurrenceState.MISSED_CONFIRMED
                            ? `−${occurrence.pointsPenaltySnapshot}`
                            : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </DashboardColumn>

        <DashboardColumn>
          {activeSanctions.length > 0 && (
            <Card>
              <CardHeader title="Sanctions en cours" />
              <CardBody className="pt-0">
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {activeSanctions.map((sanction) => (
                    <li key={sanction.id} className="py-3 text-sm">
                      <p className="font-medium">{sanction.titleSnapshot}</p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {sanction.status === 'LIFT_ELIGIBLE'
                          ? 'Condition de levee atteinte — validation requise'
                          : 'Active'}
                        {sanction.liftScoreThreshold !== null && (
                          <> · levee a {sanction.liftScoreThreshold} points</>
                        )}
                        {sanction.liftAt !== null && (
                          <> · fin prevue le {formatDateTime(sanction.liftAt, actor.timeZone)}</>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {hasCapability(actor, ParentPermission.CHILD_MANAGE) && (
            <Card>
              <CardHeader title="Profil" />
              <CardBody>
                <ChildProfileForm
                  childMembershipId={child.id}
                  displayName={child.user.displayName}
                  avatarKey={child.childProfile?.avatarKey ?? 'fox'}
                  colorKey={child.childProfile?.colorKey ?? 'sage'}
                  canDelete
                />
              </CardBody>
            </Card>
          )}
        </DashboardColumn>
      </DashboardGrid>
    </PageBody>
  );
};

export default ChildDetailPage;
