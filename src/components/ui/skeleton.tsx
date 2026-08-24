import { cn } from '@/lib/cn';

/** Squelette de chargement. `aria-hidden` : le contenu reel sera annonce a l'arrivee. */
export const Skeleton = ({ className }: { readonly className?: string }) => (
  <div aria-hidden="true" className={cn('skeleton rounded-[var(--radius-control)]', className)} />
);

export const SkeletonCard = () => (
  <div className="rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5">
    <Skeleton className="h-5 w-1/3" />
    <Skeleton className="mt-3 h-4 w-2/3" />
    <Skeleton className="mt-4 h-2.5 w-full" />
  </div>
);
