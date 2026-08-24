import type { Metadata } from 'next';
import Link from 'next/link';
import { ActionRequiredPanel } from '@/components/parent/action-required-panel';
import { ChildSummaryCard } from '@/components/parent/child-summary-card';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { requireParentActor } from '@/server/auth/context';
import { getParentDashboard } from '@/server/queries/parent-dashboard';

export const metadata: Metadata = { title: 'Tableau de bord' };

/**
 * Tableau de bord parent.
 *
 * Ordre volontaire : d'abord ce qui attend une decision, ensuite l'etat de
 * chaque enfant. Un parent qui ouvre l'application cherche d'abord a savoir
 * s'il doit agir.
 */
const ParentDashboardPage = async () => {
  const actor = await requireParentActor();
  const dashboard = await getParentDashboard(actor);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <ActionRequiredPanel counts={dashboard.actionsRequired} />

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--text-muted)] uppercase">
            Les enfants
          </h2>
          <Link href="/parent/enfants">
            <Button variant="ghost" size="sm">
              Gerer
            </Button>
          </Link>
        </div>

        {dashboard.children.length === 0 ? (
          <Card>
            <EmptyState
              title="Aucun enfant dans la famille"
              description="Invitez votre premier enfant : il rejoindra la famille avec un code a usage unique."
              action={
                <Link href="/parent/enfants">
                  <Button>Inviter un enfant</Button>
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {dashboard.children.map((child) => (
              <ChildSummaryCard key={child.membershipId} child={child} />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader
          title="Comment FamiliPact fonctionne"
          description="Un rappel utile quand on hesite sur ce que l'application fait toute seule."
        />
        <CardBody className="pt-0">
          <ol className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>1. Vous definissez les taches, les points, les paliers et les seuils.</li>
            <li>2. L&apos;enfant declare une tache terminee.</li>
            <li>3. Vous validez : les points sont credites une seule fois.</li>
            <li>4. Le systeme detecte un palier ou un seuil et vous le signale.</li>
            <li>5. Rien n&apos;est accorde ni active sans votre decision explicite.</li>
          </ol>
        </CardBody>
      </Card>
    </div>
  );
};

export default ParentDashboardPage;
