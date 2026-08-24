import type { Metadata } from 'next';
import { PageBody } from '@/components/layout/page-body';
import { redirect } from 'next/navigation';
import { ParentPermission } from '@/generated/prisma/enums';
import { TaskForm } from '@/components/parent/task-form';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { hasCapability, requireParentActor } from '@/server/auth/context';
import { listChildren } from '@/server/services/children';

export const metadata: Metadata = { title: 'Nouvelle tache' };

const NewTaskPage = async () => {
  const actor = await requireParentActor();
  // Verification cote serveur : masquer le lien ne suffirait pas.
  if (!hasCapability(actor, ParentPermission.TASK_MANAGE)) redirect('/parent/taches');

  const children = await listChildren(actor);

  return (
    <PageBody largeur="lecture">
      <Card>
        <CardHeader
          title="Nouvelle tache"
          description="Les points ne sont credites ou retires qu'apres votre validation, jamais automatiquement."
        />
        <CardBody>
          <TaskForm
            children={children.map((child) => ({
              id: child.id,
              displayName: child.user.displayName,
            }))}
          />
        </CardBody>
      </Card>
    </PageBody>
  );
};

export default NewTaskPage;
