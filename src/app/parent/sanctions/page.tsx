import type { Metadata } from 'next';
import { ParentPermission, SanctionInstanceStatus } from '@/generated/prisma/enums';
import { SanctionActivationCard } from '@/components/parent/sanction-activation-card';
import { SanctionLiftCard } from '@/components/parent/sanction-lift-card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SANCTION_STATUS_LABELS } from '@/domain/rules-engine';
import { formatDate, formatDateTime } from '@/lib/format';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { listSanctionInstances } from '@/server/queries/parent-lists';

export const metadata: Metadata = { title: 'Sanctions' };

/**
 * Sanctions : propositions, sanctions en cours, historique.
 *
 * Un encart rappelle en permanence que FamiliPact n'agit sur aucun appareil.
 * C'est la limite la plus importante du produit et elle doit rester visible.
 */
const SanctionsPage = async () => {
  const actor = await requireParentActor();
  const instances = await listSanctionInstances(actor);

  const proposed = instances.filter((item) => item.status === SanctionInstanceStatus.PROPOSED);
  const ongoing = instances.filter(
    (item) =>
      item.status === SanctionInstanceStatus.ACTIVE ||
      item.status === SanctionInstanceStatus.LIFT_ELIGIBLE,
  );
  const past = instances.filter(
    (item) =>
      item.status === SanctionInstanceStatus.LIFTED ||
      item.status === SanctionInstanceStatus.IGNORED ||
      item.status === SanctionInstanceStatus.CANCELLED,
  );

  const canActivate = hasCapability(actor, ParentPermission.SANCTION_ACTIVATE);
  const canLift = hasCapability(actor, ParentPermission.SANCTION_LIFT);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Card className="border-amber-soft-200 bg-amber-soft-50 dark:border-amber-soft-700 dark:bg-amber-soft-900/20">
        <CardBody className="pt-5">
          <p className="text-amber-soft-900 dark:text-amber-soft-100 text-sm">
            <strong>FamiliPact n&apos;applique aucune sanction.</strong> L&apos;application
            enregistre, calcule et affiche. Elle ne bloque aucun telephone, aucune application et
            aucun acces : la mise en oeuvre reste entierement de votre ressort.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sanctions proposees"
          description="Un seuil a ete franchi. Rien n'est actif tant que vous n'avez pas decide."
        />
        <CardBody className="pt-0">
          {proposed.length === 0 ? (
            <EmptyState title="Aucune sanction proposee" />
          ) : !canActivate ? (
            <EmptyState
              title={`${proposed.length} proposition${proposed.length > 1 ? 's' : ''} en attente`}
              description="Vous n'avez pas la permission d'activer une sanction. Demandez-la au proprietaire de la famille."
            />
          ) : (
            <ul>
              {proposed.map((instance) => (
                <SanctionActivationCard
                  key={instance.id}
                  instanceId={instance.id}
                  title={instance.titleSnapshot}
                  description={instance.descriptionSnapshot}
                  child={{
                    displayName: instance.child.user.displayName,
                    avatarKey: instance.child.childProfile?.avatarKey ?? 'fox',
                    colorKey: instance.child.childProfile?.colorKey ?? 'sage',
                  }}
                  threshold={instance.thresholdSnapshot}
                  comparator={instance.comparatorSnapshot}
                  scoreAtProposal={instance.scoreAtProposal}
                  currentScore={instance.child.childProfile?.cachedBalance ?? 0}
                  defaults={{
                    liftConditionType: instance.sanctionRule.liftConditionType,
                    liftScoreThreshold: instance.sanctionRule.liftScoreThreshold,
                    liftDurationDays: instance.sanctionRule.liftDurationDays,
                  }}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Sanctions en cours"
          description="Une condition atteinte ne leve rien : elle ouvre la possibilite de lever."
        />
        <CardBody className="pt-0">
          {ongoing.length === 0 ? (
            <EmptyState title="Aucune sanction active" />
          ) : (
            <ul>
              {ongoing.map((instance) => (
                <SanctionLiftCard
                  key={instance.id}
                  instanceId={instance.id}
                  title={instance.titleSnapshot}
                  description={instance.descriptionSnapshot}
                  child={{
                    displayName: instance.child.user.displayName,
                    avatarKey: instance.child.childProfile?.avatarKey ?? 'fox',
                    colorKey: instance.child.childProfile?.colorKey ?? 'sage',
                  }}
                  status={instance.status as 'ACTIVE' | 'LIFT_ELIGIBLE'}
                  liftConditionType={instance.liftConditionType}
                  liftAt={instance.liftAt?.toISOString() ?? null}
                  liftScoreThreshold={instance.liftScoreThreshold}
                  currentScore={instance.child.childProfile?.cachedBalance ?? 0}
                  activatedAtLabel={
                    instance.activatedAt !== null
                      ? formatDate(instance.activatedAt, actor.timeZone)
                      : null
                  }
                  liftAtLabel={
                    instance.liftAt !== null
                      ? formatDateTime(instance.liftAt, actor.timeZone)
                      : null
                  }
                  canLift={canLift}
                />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Historique des sanctions" />
        <CardBody className="pt-0">
          {past.length === 0 ? (
            <EmptyState title="Aucune sanction terminee" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {past.map((instance) => (
                <li key={instance.id} className="flex items-start gap-3 py-3">
                  <Avatar
                    avatarKey={instance.child.childProfile?.avatarKey ?? 'fox'}
                    colorKey={instance.child.childProfile?.colorKey ?? 'sage'}
                    name={instance.child.user.displayName}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{instance.titleSnapshot}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {instance.child.user.displayName}
                      {instance.activatedBy !== null && (
                        <> · activee par {instance.activatedBy.user.displayName}</>
                      )}
                      {instance.liftedBy !== null && (
                        <> · levee par {instance.liftedBy.user.displayName}</>
                      )}
                      {instance.liftedAt !== null && (
                        <> le {formatDate(instance.liftedAt, actor.timeZone)}</>
                      )}
                    </p>
                  </div>
                  <Badge tone={instance.status === 'LIFTED' ? 'positive' : 'neutral'}>
                    {SANCTION_STATUS_LABELS[instance.status]}
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

export default SanctionsPage;
