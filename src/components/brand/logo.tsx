import { cn } from '@/lib/cn';

/**
 * Marque FamiliPact.
 *
 * Deux arcs qui se rejoignent : l'idee du pacte, d'un accord tenu a deux.
 * Volontairement geometrique et sobre — ni mascotte, ni bouclier, ni cadenas :
 * FamiliPact n'est pas un outil de surveillance et son identite ne doit pas le
 * laisser croire.
 */
export const LogoMark = ({ className }: { readonly className?: string }) => (
  <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden="true" focusable="false">
    <path
      d="M9 22V13a7 7 0 0 1 14 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="M23 10v9a7 7 0 0 1-14 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeOpacity="0.45"
    />
  </svg>
);

export const Wordmark = ({ className }: { readonly className?: string }) => (
  <span className={cn('inline-flex items-center gap-2', className)}>
    <LogoMark className="text-pact-600 dark:text-pact-400 size-7" />
    <span className="text-[1.0625rem] font-semibold tracking-tight text-[var(--text-primary)]">
      Famili<span className="text-pact-600 dark:text-pact-400">Pact</span>
    </span>
  </span>
);
