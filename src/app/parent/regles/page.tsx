import type { Metadata } from 'next';
import { DashboardColumn, DashboardGrid, PageBody } from '@/components/layout/page-body';
import { ParentPermission } from '@/generated/prisma/enums';
import { RewardRuleForm, SanctionRuleForm } from '@/components/parent/rule-forms';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LIFT_CONDITION_LABELS } from '@/domain/rules-engine';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { listRewardRules, listSanctionRules } from '@/server/queries/parent-lists';
import { listChildren } from '@/server/services/children';

export const metadata: Metadata = { title: 'Regles' };

/**
 * Regles de recompense et de sanction.
 *
 * Le comportement du moteur est explique a cote de chaque liste : detection
 * automatique d'un cote, decision parentale de l'autre. Le produit repose sur
 * cette distinction, elle doit etre lisible sans lire la documentation.
 */
const RulesPage = async () => {
  const actor = await requireParentActor();
  const canManage = hasCapability(actor, ParentPermission.RULE_MANAGE);
  const [rewardRules, sanctionRules, children] = await Promise.all([
    listRewardRules(actor),
    listSanctionRules(actor),
    listChildren(actor),
  ]);

  const childOptions = children.map((child) => ({
    id: child.id,
    displayName: child.user.displayName,
  }));

  return (
    <PageBody largeur="tableauDeBord">
      <DashboardGrid>
        {/* A gauche ce qui existe deja, a droite de quoi en ajouter :
            consulter et creer sont deux gestes differents. */}
        <DashboardColumn>
          <Card>
            <CardHeader
              title="Paliers de recompense"
              description="Quand le score atteint le palier, le systeme propose la recompense. Vous la validez ou l'ignorez."
            />
            <CardBody className="pt-0">
              {rewardRules.length === 0 ? (
                <EmptyState title="Aucun palier defini" />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {rewardRules.map((rule) => {
                    const event = rule.events[0];
                    const score = rule.child.childProfile?.cachedBalance ?? 0;
                    return (
                      <li key={rule.id} className="flex items-start gap-3 py-3">
                        <Avatar
                          avatarKey={rule.child.childProfile?.avatarKey ?? 'fox'}
                          colorKey={rule.child.childProfile?.colorKey ?? 'sage'}
                          name={rule.child.user.displayName}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{rule.title}</p>
                          <p className="tabular mt-0.5 text-xs text-[var(--text-muted)]">
                            {rule.child.user.displayName} · palier {rule.threshold} points · score
                            actuel {score}
                          </p>
                        </div>
                        {event === undefined ? (
                          <Badge tone="info">En cours</Badge>
                        ) : (
                          <Badge tone={event.status === 'GRANTED' ? 'positive' : 'neutral'}>
                            {event.status === 'GRANTED'
                              ? 'Obtenue'
                              : event.status === 'IGNORED'
                                ? 'Ignoree'
                                : 'A valider'}
                          </Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Regles de sanction"
              description="Le franchissement d'un seuil cree une proposition. Rien ne devient actif sans votre decision."
            />
            <CardBody className="pt-0">
              {sanctionRules.length === 0 ? (
                <EmptyState title="Aucune regle de sanction definie" />
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {sanctionRules.map((rule) => (
                    <li key={rule.id} className="flex items-start gap-3 py-3">
                      <Avatar
                        avatarKey={rule.child.childProfile?.avatarKey ?? 'fox'}
                        colorKey={rule.child.childProfile?.colorKey ?? 'sage'}
                        name={rule.child.user.displayName}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{rule.title}</p>
                        <p className="tabular mt-0.5 text-xs text-[var(--text-muted)]">
                          {rule.child.user.displayName} · score{' '}
                          {rule.comparator === 'LTE' ? '≤' : '<'} {rule.threshold} · levee :{' '}
                          {LIFT_CONDITION_LABELS[rule.liftConditionType]}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                          {rule.armed
                            ? 'Armee : le prochain passage sous le seuil creera une proposition.'
                            : 'Desarmee : le score doit repasser au-dessus du seuil avant une nouvelle proposition.'}
                        </p>
                      </div>
                      <Badge tone={rule.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                        {rule.status === 'ACTIVE' ? 'Active' : 'Suspendue'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </DashboardColumn>

        <DashboardColumn>
          {canManage && childOptions.length > 0 && (
            <Card>
              <CardHeader title="Ajouter un palier" />
              <CardBody>
                <RewardRuleForm children={childOptions} />
              </CardBody>
            </Card>
          )}

          {canManage && childOptions.length > 0 && (
            <Card>
              <CardHeader title="Ajouter une regle de sanction" />
              <CardBody>
                <SanctionRuleForm children={childOptions} />
              </CardBody>
            </Card>
          )}
        </DashboardColumn>
      </DashboardGrid>
    </PageBody>
  );
};

export default RulesPage;
