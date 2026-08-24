import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Card = ({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { readonly children: ReactNode }) => (
  <div
    className={cn(
      'rounded-[var(--radius-card)] border border-[var(--border-subtle)]',
      'bg-[var(--surface-raised)] shadow-[var(--shadow-soft)]',
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
