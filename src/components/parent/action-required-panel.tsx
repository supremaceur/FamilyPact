import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import type { ActionRequiredCountsView } from '@/lib/read-models';

/**
 * Bandeau « Actions requises ».
 *
 * C'est le coeur du tableau de bord parent : en ouvrant l'application, un
 * parent doit comprendre en une seconde ce qui attend une decision de sa part.
 * Chaque ligne mene directement a l'ecran de decision correspondant.
 */
const ROWS: readonly {
  readonly key: Exclude<keyof ActionRequiredCountsView, 'total'>;
  readonly href: string;
  readonly label: (count: number) => string;
}[] = [
  {
    key: 'taskApprovals',
    href: '/parent/validations#taches-terminees',
    label: (count) =>
      count === 1
        ? '1 tache declaree terminee a valider'
        : `${count} taches declarees terminees a valider`,
  },
  {
    key: 'missedReviews',
    href: '/parent/validations#taches-manquees',
    label: (count) =>
      count === 1
        ? '1 tache non realisee : confirmer ou ignorer'
        : `${count} taches non realisees : confirmer ou ignorer`,
  },
  {
    key: 'rewardApprovals',
    href: '/parent/recompenses',
    label: (count) =>
      count === 1 ? '1 recompense proposee a valider' : `${count} recompenses proposees a valider`,
  },
  {
    key: 'rewardRevocations',
    href: '/parent/recompenses',
    label: (count) =>
      count === 1
        ? '1 recompense a revoir : le score est repasse sous le palier'
        : `${count} recompenses a revoir : le score est repasse sous le palier`,
  },
  {
    key: 'sanctionActivations',
    href: '/parent/sanctions',
    label: (count) =>
      count === 1
        ? '1 sanction proposee : activer ou ignorer'
        : `${count} sanctions proposees : activer ou ignorer`,
  },
  {
    key: 'sanctionLifts',
    href: '/parent/sanctions',
    label: (count) =>
      count === 1
        ? '1 sanction dont la condition de levee est atteinte'
        : `${count} sanctions dont la condition de levee est atteinte`,
  },
];

export const ActionRequiredPanel = ({ counts }: { readonly counts: ActionRequiredCountsView }) => (
  // Le lisere teal ne s'allume que s'il y a effectivement une decision a
  // prendre : un accent permanent cesse d'attirer l'oeil au bout d'un jour.
  <Card tone={counts.total > 0 ? 'lead' : 'default'}>
    <CardHeader
      title="Actions requises"
      description={
        counts.total > 0
          ? "Ces decisions n'ont d'effet qu'une fois que vous les prenez."
          : undefined
      }
    />
    <CardBody className="pt-0">
      {counts.total === 0 ? (
        <EmptyState
          title="Rien ne demande votre attention"
          description="Les taches declarees terminees, les echeances depassees et les propositions du systeme apparaitront ici."
        />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {ROWS.filter((row) => counts[row.key] > 0).map((row) => (
            <li key={row.key}>
              <Link
                href={row.href}
                className="hover:text-pact-700 dark:hover:text-pact-300 flex min-h-14 items-center justify-between gap-3 py-3 text-sm"
              >
                <span className="flex items-center gap-3">
                  <span className="tabular bg-amber-soft-100 text-amber-soft-900 dark:bg-amber-soft-900/40 dark:text-amber-soft-100 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                    {counts[row.key]}
                  </span>
                  <span>{row.label(counts[row.key])}</span>
                </span>
                <ChevronIcon />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardBody>
  </Card>
);

const ChevronIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-4 shrink-0 text-[var(--text-muted)]"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
);
