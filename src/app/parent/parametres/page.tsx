import type { Metadata } from 'next';
import { ParentPermission } from '@/generated/prisma/enums';
import { FamilySettingsForm } from '@/components/parent/family-settings-form';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { OwnerCapability } from '@/domain/permissions';
import { hasCapability, requireParentActor } from '@/server/auth/context';

export const metadata: Metadata = { title: 'Parametres' };

const SettingsPage = async () => {
  const actor = await requireParentActor();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Card>
        <CardHeader title="Parametres de la famille" />
        <CardBody>
          <FamilySettingsForm
            name={actor.familyName}
            timeZone={actor.timeZone}
            canEdit={hasCapability(actor, ParentPermission.FAMILY_SETTINGS_MANAGE)}
            canDelete={hasCapability(actor, OwnerCapability.FAMILY_DELETE)}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Vos donnees" />
        <CardBody>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li>FamiliPact ne collecte aucune donnee de localisation.</li>
            <li>
              Aucune photo d&apos;enfant n&apos;est stockee : les avatars sont des dessins
              embarques.
            </li>
            <li>
              Aucune donnee n&apos;est revendue et aucun traceur publicitaire n&apos;est utilise.
            </li>
            <li>
              Supprimer un enfant ou la famille efface reellement les donnees : ce n&apos;est pas un
              simple masquage.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
};

export default SettingsPage;
