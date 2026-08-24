import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Etiquette d'etat.
 *
 * Chaque variante porte une COULEUR **et** un libelle explicite : l'etat n'est
 * jamais transmis par la seule couleur (WCAG 1.4.1).
 */
export type BadgeTone = 'neutral' | 'pending' | 'positive' | 'negative' | 'info';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--surface-sunken)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
  pending: 'bg-amber-soft-100 text-amber-soft-900 border-amber-soft-200',
  positive: 'bg-leaf-100 text-leaf-900 border-leaf-200',
  negative: 'bg-clay-100 text-clay-900 border-clay-200',
  info: 'bg-pact-100 text-pact-900 border-pact-200',
};

export const Badge = ({
  tone = 'neutral',
  children,
  className,
}: {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5',
      'text-xs font-medium whitespace-nowrap',
      TONE_CLASSES[tone],
      className,
    )}
  >
    {children}
  </span>
);
