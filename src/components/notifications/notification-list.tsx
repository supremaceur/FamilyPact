'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

export interface NotificationRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly linkPath: string | null;
  readonly createdAtLabel: string;
  readonly read: boolean;
}

/**
 * Centre de notifications.
 *
 * Les notifications sont un confort : aucune regle metier n'en depend. Une
 * notification manquante ne change jamais un score ni une decision.
 */
export const NotificationList = ({
  notifications,
}: {
  readonly notifications: readonly NotificationRow[];
}) => {
  const action = useAction();
  const unread = notifications.filter((notification) => !notification.read);

  return (
    <div>
      {unread.length > 0 && (
        <Button
          variant="secondary"
          size="sm"
          className="mb-4"
          pending={action.pending}
          onClick={() => void action.run(() => apiPost('/api/notifications', { ids: [] }))}
        >
          Tout marquer comme lu
        </Button>
      )}

      <ul className="divide-y divide-[var(--border-subtle)]">
        {notifications.map((notification) => {
          const content: ReactNode = (
            <div className="flex items-start gap-2">
              {!notification.read && (
                <span
                  className="bg-pact-600 dark:bg-pact-400 mt-1.5 size-2 shrink-0 rounded-full"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {notification.title}
                  {!notification.read && <span className="sr-only"> (non lue)</span>}
                </p>
                <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{notification.body}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {notification.createdAtLabel}
                </p>
              </div>
            </div>
          );

          return (
            <li key={notification.id} className="py-3">
              {notification.linkPath !== null ? (
                <Link href={notification.linkPath} className="block hover:opacity-80">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
