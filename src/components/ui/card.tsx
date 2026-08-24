import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Carte.
 *
 * `tone="lead"` designe la carte qui attend une decision. Elle recoit un
 * lisere teal et une ombre plus marquee : sur un tableau de bord ou tout se
 * ressemble, l'oeil doit trouver sans lire. Une seule carte par ecran devrait
 * le porter — deux accents ne designent plus rien.
 *
 * La surface est un degrade tres court plutot qu'un aplat, avec un filet clair
 * en haut (`--card-inset`). C'est ce qui pose la carte sur le fond au lieu de
 * l'y decouper.
 *
 * Toutes les cartes portent une bordure teintee vers le teal (`--card-ring`),
 * pas un gris neutre : elles appartiennent ainsi a la meme famille que
 * l'accent. Le lisere `lead` reste nettement plus marque — sinon il ne
 * designerait plus rien.
 */
export const Card = ({
  tone = 'default',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  readonly tone?: 'default' | 'lead';
  readonly children: ReactNode;
}) => (
  <div
    className={cn(
      'rounded-[var(--radius-card)] border',
      'bg-[image:var(--card-surface)]',
      tone === 'lead'
        ? 'border-[var(--lead-ring)] shadow-[var(--card-inset),var(--lead-glow)]'
        : 'border-[var(--card-ring)] shadow-[var(--card-inset),var(--shadow-soft)]',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
);

export const CardHeader = ({
  title,
  description,
  action,
  className,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}) => (
  <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
    <div className="min-w-0">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
      {description !== undefined && (
        <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
      )}
    </div>
    {action !== undefined && <div className="shrink-0">{action}</div>}
  </div>
);

export const CardBody = ({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) => <div className={cn('px-5 pb-5', className)}>{children}</div>;
