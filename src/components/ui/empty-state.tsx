import type { ReactNode } from 'react';

/**
 * Etat vide honnete : il decrit ce qui manque et ce qu'on peut faire, sans
 * jamais inventer de contenu factice pour « remplir » l'ecran.
 */
export const EmptyState = ({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}) => (
  <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
    <p className="text-[0.9375rem] font-medium text-[var(--text-primary)]">{title}</p>
    {description !== undefined && (
      <p className="max-w-sm text-sm text-[var(--text-muted)]">{description}</p>
    )}
    {action !== undefined && <div className="mt-3">{action}</div>}
  </div>
);
