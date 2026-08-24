import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Bandeau de resume de l'espace enfant — direction « Halo ».
 *
 * Trois reperes en haut d'ecran, avant tout le reste : ce qu'il reste a faire,
 * ce qui attend un parent, ce qui est en cours. Chacun mene a l'ecran concerne.
 *
 * IL ENROULE, IL NE DEFILE PAS. La maquette montrait des cartes cote a cote ;
 * les faire defiler horizontalement aurait cache le troisieme repere sur un
 * petit ecran, sans rien pour le signaler. `flex-wrap` garde tout visible et
 * atteignable au clavier.
 *
 * CE N'EST PAS UN TABLEAU DE SCORE. Aucun de ces chiffres n'est une
 * performance : ce sont des quantites de choses a faire ou en attente. Pas de
 * serie, pas de niveau, pas de comparaison avec quiconque.
 */
const TONS = {
  faire: 'border-[var(--lead-ring)] shadow-[var(--lead-glow)]',
  attente: 'border-[var(--card-ring)] shadow-[var(--card-inset)]',
  encours: 'border-[var(--card-ring)] shadow-[var(--card-inset)]',
} as const;

export interface Repere {
  readonly cle: keyof typeof TONS;
  readonly libelle: string;
  readonly valeur: number;
  readonly href: string;
  /** Ce que le chiffre veut dire, en trois mots. */
  readonly precision: string;
}

export const SummaryStrip = ({ reperes }: { readonly reperes: readonly Repere[] }) => {
  const visibles = reperes.filter((repere) => repere.valeur > 0);
  if (visibles.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-3">
      {visibles.map((repere) => (
        <li key={repere.cle} className="min-w-[9.5rem] flex-1">
          <Link
            href={repere.href}
            className={cn(
              'flex min-h-[4.75rem] flex-col justify-center gap-0.5 rounded-[var(--radius-card)] border',
              'bg-[image:var(--card-surface)] px-4 py-3',
              'transition-opacity hover:opacity-85',
              TONS[repere.cle],
            )}
          >
            <span className="text-xs text-[var(--text-muted)]">{repere.libelle}</span>
            <span className="flex items-baseline gap-1.5">
              <span className="tabular text-2xl leading-none font-semibold">{repere.valeur}</span>
              <span className="text-xs text-[var(--text-muted)]">{repere.precision}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
};
