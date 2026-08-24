import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type AlertTone = 'info' | 'warning' | 'error' | 'success';

const TONE_CLASSES: Record<AlertTone, string> = {
  info: 'bg-pact-50 border-pact-200 text-pact-900 dark:bg-pact-950 dark:text-pact-100 dark:border-pact-800',
  warning:
    'bg-amber-soft-50 border-amber-soft-200 text-amber-soft-900 dark:bg-amber-soft-900/25 dark:text-amber-soft-100 dark:border-amber-soft-700',
  error:
    'bg-clay-50 border-clay-200 text-clay-900 dark:bg-clay-900/25 dark:text-clay-100 dark:border-clay-700',
  success:
    'bg-leaf-50 border-leaf-200 text-leaf-900 dark:bg-leaf-900/25 dark:text-leaf-100 dark:border-leaf-700',
};

/**
 * Message contextuel.
 *
 * Les erreurs et avertissements portent `role="alert"` : ils sont annonces
 * immediatement par les lecteurs d'ecran, ce qui est indispensable pour un
 * message d'echec de formulaire.
 */
export const Alert = ({
  tone = 'info',
  title,
  children,
  className,
}: {
  readonly tone?: AlertTone;
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}) => (
  <div
    role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
    className={cn(
      'rounded-[var(--radius-control)] border px-4 py-3 text-sm',
      TONE_CLASSES[tone],
      className,
    )}
  >
    {title !== undefined && <p className="font-semibold">{title}</p>}
    {children !== undefined && <div className={cn(title !== undefined && 'mt-1')}>{children}</div>}
  </div>
);
