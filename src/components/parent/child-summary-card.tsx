import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress';
import type { ChildSummaryView } from '@/lib/read-models';

/**
 * Carte de synthese d'un enfant.
 *
 * Elle repond aux quatre questions qu'un parent se pose en ouvrant
 * l'application : ou en est le score, qu'est-ce qui attend une decision, y
 * a-t-il une sanction en cours, et quel est le prochain objectif.
 */
export const ChildSummaryCard = ({ child }: { readonly child: ChildSummaryView }) => (
  <Card className="overflow-hidden">
    <Link
      href={`/parent/enfants/${child.membershipId}`}
      className="block p-5 hover:bg-[var(--surface-sunken)]"
    >
      <div className="flex items-start gap-3">
        <Avatar
          avatarKey={child.avatarKey}
          colorKey={child.colorKey}
          name={child.displayName}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{child.displayName}</p>
          <p className="tabular mt-0.5 text-2xl font-semibold text-[var(--text-primary)]">
            {child.score}
            <span className="ml-1 text-sm font-normal text-[var(--text-muted)]">points</span>
          </p>
        </div>
      </div>

      {(child.pendingApprovals > 0 || child.pendingMissed > 0 || child.activeSanctions > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {child.pendingApprovals > 0 && (
            <Badge tone="pending">{child.pendingApprovals} a valider</Badge>
          )}
          {child.pendingMissed > 0 && (
            <Badge tone="pending">{child.pendingMissed} a confirmer</Badge>
          )}
          {child.activeSanctions > 0 && (
            <Badge tone="negative">
              {child.activeSanctions} sanction{child.activeSanctions > 1 ? 's' : ''} active
              {child.activeSanctions > 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      )}

      {child.nextReward === null ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">Aucun palier de recompense defini.</p>
      ) : (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-[var(--text-secondary)]">
              Prochaine recompense : {child.nextReward.title}
            </span>
            <span className="tabular shrink-0 text-[var(--text-muted)]">
              {child.score} / {child.nextReward.threshold}
            </span>
          </div>
          <ProgressBar
            className="mt-2"
            value={child.score}
            max={child.nextReward.threshold}
            label={`Progression de ${child.displayName} vers ${child.nextReward.title}`}
          />
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {child.nextReward.remaining === 0
              ? 'Palier atteint — en attente de votre validation.'
              : `${child.nextReward.remaining} point${child.nextReward.remaining > 1 ? 's' : ''} restant${child.nextReward.remaining > 1 ? 's' : ''}`}
          </p>
        </div>
      )}
    </Link>
  </Card>
);
