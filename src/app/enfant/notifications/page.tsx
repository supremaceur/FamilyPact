import type { Metadata } from 'next';
import { NotificationList } from '@/components/notifications/notification-list';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getNotifications } from '@/server/queries/history';

export const metadata: Metadata = { title: 'Notifications' };

const ChildNotificationsPage = async () => {
  const actor = await requireChildActor();
  const notifications = await getNotifications(actor);

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader title="Notifications" />
        <CardBody className="pt-0">
          {notifications.length === 0 ? (
            <EmptyState title="Aucune notification" />
          ) : (
            <NotificationList
              notifications={notifications.map((notification) => ({
                id: notification.id,
                title: notification.title,
                body: notification.body,
                linkPath: notification.linkPath,
                createdAtLabel: formatDateTime(notification.createdAt, actor.timeZone),
                read: notification.readAt !== null,
              }))}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
};

export default ChildNotificationsPage;
