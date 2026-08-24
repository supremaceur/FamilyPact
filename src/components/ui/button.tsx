import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Bouton.
 *
 * `pending` desactive le bouton ET annonce l'etat aux lecteurs d'ecran via
 * `aria-busy` : c'est la premiere protection contre le double clic, la seconde
 * etant l'idempotence cote serveur.
 *
 * Hauteur minimale de 44 px sur les variantes principales : cible tactile
 * confortable sur mobile (recommandation WCAG 2.5.5).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'approve';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-pact-600 text-white hover:bg-pact-700 active:bg-pact-800 disabled:bg-pact-600/50 dark:bg-pact-500 dark:hover:bg-pact-400 dark:text-sand-950',
  secondary:
    'bg-[var(--surface-raised)] text-[var(--text-primary)] border border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]',
  ghost: 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]',
  danger: 'bg-clay-600 text-white hover:bg-clay-700 active:bg-clay-900 disabled:bg-clay-600/50',
  approve: 'bg-leaf-600 text-white hover:bg-leaf-700 disabled:bg-leaf-600/50',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-[0.9375rem] gap-2',
  lg: 'min-h-12 px-5 text-base gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly pending?: boolean;
  readonly fullWidth?: boolean;
  readonly children: ReactNode;
}

export const Button = ({
  variant = 'primary',
  size = 'md',
  pending = false,
  fullWidth = false,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    disabled={disabled === true || pending}
    aria-busy={pending || undefined}
    className={cn(
      'inline-flex items-center justify-center rounded-[var(--radius-control)] font-medium',
      'transition-colors duration-150',
      'disabled:cursor-not-allowed disabled:opacity-70',
      VARIANT_CLASSES[variant],
      SIZE_CLASSES[size],
      fullWidth && 'w-full',
      className,
    )}
    {...rest}
  >
    {pending ? (
      <>
        <Spinner />
        <span>Traitement…</span>
      </>
    ) : (
      children
    )}
  </button>
);

const Spinner = () => (
  <svg
    className="size-4 animate-spin"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);
