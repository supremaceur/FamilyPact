'use client';

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

/**
 * Champs de formulaire accessibles.
 *
 * Chaque champ a un `<label>` reellement associe, une description et un message
 * d'erreur relies par `aria-describedby`, et `aria-invalid` quand il est en
 * erreur. Le message d'erreur n'est jamais transmis par la seule couleur.
 */

const controlClasses = (invalid: boolean): string =>
  cn(
    'w-full rounded-[var(--radius-control)] border bg-[var(--surface-raised)]',
    'px-3 py-2.5 text-[0.9375rem] text-[var(--text-primary)]',
    'placeholder:text-[var(--text-muted)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
    invalid ? 'border-clay-500' : 'border-[var(--border-strong)]',
  );

interface FieldShellProps {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly required?: boolean;
  readonly children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

const FieldShell = ({ label, hint, error, required, children }: FieldShellProps) => {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
      .filter((value): value is string => value !== null)
      .join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[var(--text-secondary)]">
        {label}
        {required === true && (
          <span className="text-clay-600 ml-1" aria-hidden="true">
            *
          </span>
        )}
        {required === true && <span className="sr-only"> (obligatoire)</span>}
      </label>
      {children({ id, describedBy })}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-[var(--text-muted)]">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-clay-700 dark:text-clay-200 text-xs font-medium">
          {error}
        </p>
      )}
    </div>
  );
};

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'aria-describedby'
> {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
}

export const TextField = ({ label, hint, error, required, ...rest }: TextFieldProps) => (
  <FieldShell label={label} hint={hint} error={error} required={required}>
    {({ id, describedBy }) => (
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined || undefined}
        required={required}
        className={controlClasses(error !== undefined)}
        {...rest}
      />
    )}
  </FieldShell>
);

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id' | 'aria-describedby'
> {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
}

export const TextAreaField = ({ label, hint, error, required, ...rest }: TextAreaFieldProps) => (
  <FieldShell label={label} hint={hint} error={error} required={required}>
    {({ id, describedBy }) => (
      <textarea
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined || undefined}
        required={required}
        rows={3}
        className={controlClasses(error !== undefined)}
        {...rest}
      />
    )}
  </FieldShell>
);

export interface SelectFieldProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'id' | 'aria-describedby'
> {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly error?: string | undefined;
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export const SelectField = ({
  label,
  hint,
  error,
  required,
  options,
  ...rest
}: SelectFieldProps) => (
  <FieldShell label={label} hint={hint} error={error} required={required}>
    {({ id, describedBy }) => (
      <select
        id={id}
        aria-describedby={describedBy}
        aria-invalid={error !== undefined || undefined}
        required={required}
        className={controlClasses(error !== undefined)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )}
  </FieldShell>
);

/** Groupe de cases a cocher, presente comme un vrai `fieldset`. */
export const CheckboxGroup = ({
  legend,
  hint,
  options,
  selected,
  onToggle,
  disabled = false,
}: {
  readonly legend: string;
  readonly hint?: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly description?: string;
  }[];
  readonly selected: readonly string[];
  readonly onToggle: (value: string, checked: boolean) => void;
  readonly disabled?: boolean;
}) => (
  <fieldset className="flex flex-col gap-2" disabled={disabled}>
    <legend className="text-sm font-medium text-[var(--text-secondary)]">{legend}</legend>
    {hint !== undefined && <p className="text-xs text-[var(--text-muted)]">{hint}</p>}
    <div className="mt-1 flex flex-col gap-1">
      {options.map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] px-2 py-2 hover:bg-[var(--surface-sunken)]"
        >
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={selected.includes(option.value)}
            onChange={(event) => {
              onToggle(option.value, event.target.checked);
            }}
          />
          <span className="min-w-0">
            <span className="block text-sm text-[var(--text-primary)]">{option.label}</span>
            {option.description !== undefined && (
              <span className="block text-xs text-[var(--text-muted)]">{option.description}</span>
            )}
          </span>
        </label>
      ))}
    </div>
  </fieldset>
);
