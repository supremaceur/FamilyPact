import type { ReactNode } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';
import { cn } from '@/lib/cn';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly badge?: number;
}

/**
 * Coquille applicative, mobile-first.
 *
 * Navigation basse sur mobile (atteignable au pouce), laterale au-dela de
 * `lg`. La barre basse ne porte que cinq entrees : au-dela, les cibles
 * deviennent trop etroites pour un usage tactile confortable.
 *
 * L'espace parent et l'espace enfant partagent cette coquille mais affichent un
 * sous-titre distinct : on doit savoir immediatement ou l'on se trouve.
 */
export const AppShell = ({
  space,
  primaryNav,
  secondaryNav,
  headline,
  children,
  unreadNotifications = 0,
}: {
  readonly space: 'parent' | 'child';
  readonly primaryNav: readonly NavItem[];
  readonly secondaryNav?: readonly NavItem[];
  readonly headline: string;
  readonly children: ReactNode;
  readonly unreadNotifications?: number;
}) => {
  const notificationsHref = space === 'parent' ? '/parent/notifications' : '/enfant/notifications';

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="hidden w-64 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-raised)] lg:flex lg:flex-col">
        <div className="px-5 py-5">
          <Link href={space === 'parent' ? '/parent' : '/enfant'}>
            <Wordmark />
          </Link>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {space === 'parent' ? 'Espace parent' : 'Mon espace'}
          </p>
        </div>
        <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 pb-6">
          <ul className="flex flex-col gap-0.5">
            {primaryNav.map((item) => (
              <SidebarLink key={item.href} item={item} />
            ))}
          </ul>
          {secondaryNav !== undefined && secondaryNav.length > 0 && (
            <>
              <hr className="my-4 border-[var(--border-subtle)]" />
              <ul className="flex flex-col gap-0.5">
                {secondaryNav.map((item) => (
                  <SidebarLink key={item.href} item={item} />
                ))}
              </ul>
            </>
          )}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'sticky top-0 z-10 border-b border-[var(--border-subtle)]',
            'bg-[var(--surface-raised)]/90 backdrop-blur',
            'px-5 py-3.5 lg:px-8',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 lg:hidden">
              <Wordmark />
            </div>
            <h1 className="hidden min-w-0 truncate text-lg font-semibold lg:block">{headline}</h1>
            <Link
              href={notificationsHref}
              className="relative inline-flex size-10 items-center justify-center rounded-full hover:bg-[var(--surface-sunken)]"
              aria-label={
                unreadNotifications > 0
                  ? `Notifications, ${unreadNotifications} non lue${unreadNotifications > 1 ? 's' : ''}`
                  : 'Notifications'
              }
            >
              <BellIcon />
              {unreadNotifications > 0 && (
                <span
                  className="tabular bg-clay-600 absolute top-1.5 right-1.5 min-w-4 rounded-full px-1 text-[0.625rem] leading-4 font-semibold text-white"
                  aria-hidden="true"
                >
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </Link>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight lg:hidden">{headline}</h1>
        </header>

        <main id="contenu" className="flex-1 px-5 pt-5 pb-28 lg:px-8 lg:pb-10">
          {children}
        </main>

        <nav
          aria-label="Navigation principale"
          className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        >
          <ul className="mx-auto flex max-w-lg">
            {primaryNav.slice(0, 5).map((item) => (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.6875rem] text-[var(--text-secondary)]"
                >
                  <span className="relative">
                    {item.icon}
                    {item.badge !== undefined && item.badge > 0 && (
                      <span
                        className="tabular bg-clay-600 absolute -top-1 -right-2 min-w-4 rounded-full px-1 text-[0.5625rem] leading-4 font-semibold text-white"
                        aria-hidden="true"
                      >
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
};

const SidebarLink = ({ item }: { readonly item: NavItem }) => (
  <li>
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
    >
      <span className="text-[var(--text-muted)]">{item.icon}</span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span className="tabular bg-clay-600 min-w-5 rounded-full px-1.5 text-center text-[0.6875rem] font-semibold text-white">
          {item.badge}
        </span>
      )}
    </Link>
  </li>
);

const BellIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path
      d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" />
  </svg>
);
