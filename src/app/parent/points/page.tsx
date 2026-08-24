import type { Metadata } from 'next';
import { PageBody } from '@/components/layout/page-body';
import { ParentPermission } from '@/generated/prisma/enums';
import { AdjustPointsForm } from '@/components/parent/adjust-points-form';
import { LedgerTable } from '@/components/parent/ledger-table';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { getLedgerHistory } from '@/server/queries/history';
import { listChildren } from '@/server/services/children';

export const metadata: Metadata = { title: 'Points' };

/**
 * Ledger de points de la famille.
 *
 * Le solde affiche est celui du ledger : c'est la somme des mouvements, pas un
 * compteur modifiable a la main.
 */
const PointsPage = async ({
  searchParams,
}: {
  readonly searchParams: Promise<{ cursor?: string; enfant?: string }>;
}) => {
  const actor = await requireParentActor();
  const { cursor, enfant } = await searchParams;
  const canAdjust = hasCapability(actor, ParentPermission.POINTS_ADJUST);

  const [ledger, children] = await Promise.all([
    getLedgerHistory(actor, {
      childMembershipId: enfant ?? null,
      cursor: cursor ?? null,
    }),
    listChildren(actor),
  ]);

  return (
    <PageBody largeur="liste" className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Soldes"
          description="Le solde est la somme du journal des transactions, jamais un chiffre saisi directement."
        />
        <CardBody className="pt-0">
          {children.length === 0 ? (
            <EmptyState title="Aucun enfant dans la famille" />
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {children.map((child) => (
                <li key={child.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="text-sm font-medium">{child.user.displayName}</span>
                  <span className="tabular text-lg font-semibold">
                    {child.childProfile?.cachedBalance ?? 0}
                    <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">
                      points
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canAdjust && (
        <Card>
          <CardHeader
            title="Ajustement manuel"
            description="Pour corriger une erreur ou tenir compte d'un evenement hors application."
          />
          <CardBody>
            <AdjustPointsForm
              children={children.map((child) => ({
                id: child.id,
                displayName: child.user.displayName,
                score: child.childProfile?.cachedBalance ?? 0,
              }))}
            />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Mouvements de points"
          description="Une correction ajoute une ligne inverse : rien n'est jamais reecrit."
        />
        <CardBody className="pt-0">
          {ledger.items.length === 0 ? (
            <EmptyState title="Aucun mouvement enregistre" />
          ) : (
            <>
              <LedgerTable
                canAdjust={canAdjust}
                rows={ledger.items.map((row) => ({
                  id: row.id,
                  delta: row.delta,
                  type: row.type,
                  label: row.label,
                  reason: row.reason,
                  createdAtLabel: formatDateTime(row.createdAt, actor.timeZone),
                  childName: row.child.user.displayName,
                  approvedByName: row.approvedBy?.user.displayName ?? null,
                  reversesTransactionId: row.reversesTransactionId,
                  reversed: row.reversedBy !== null,
                }))}
              />
              {ledger.nextCursor !== null && (
                <a
                  href={`/parent/points?cursor=${ledger.nextCursor}${enfant !== undefined ? `&enfant=${enfant}` : ''}`}
                  className="text-pact-700 dark:text-pact-300 mt-4 inline-block text-sm font-medium underline underline-offset-4"
                >
                  Voir les mouvements plus anciens
                </a>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </PageBody>
  );
};

export default PointsPage;
