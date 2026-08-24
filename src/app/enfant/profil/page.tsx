import type { Metadata } from 'next';
import { PasskeyManager } from '@/components/security/passkey-manager';
import { LogoutButton } from '@/components/security/logout-button';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import { requireChildActor } from '@/server/auth/context';
import { getChildDashboard } from '@/server/queries/child-dashboard';
import { listPasskeys } from '@/server/services/passkeys';

export const metadata: Metadata = { title: 'Mon profil' };

/**
 * Profil enfant.
 *
 * En lecture seule : le prenom et l'avatar sont geres par un parent. Une cle
 * d'acces reste proposee — facultative, elle simplifie la connexion sans
 * imposer de double authentification a un enfant.
 */
const ChildProfilePage = async () => {
  const actor = await requireChildActor();
  const [data, passkeys] = await Promise.all([
    getChildDashboard(actor),
    listPasskeys(actor.userId),
  ]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Card>
        <CardBody className="flex items-center gap-4 pt-5">
          <Avatar
            avatarKey={data.avatarKey}
            colorKey={data.colorKey}
            name={actor.displayName}
            size="lg"
          />
          <div className="min-w-0">
            <p className="text-lg font-semibold">{actor.displayName}</p>
            <p className="text-sm text-[var(--text-muted)]">
              Identifiant : {actor.session.user.loginId ?? '—'}
            </p>
            <p className="text-sm text-[var(--text-muted)]">Famille : {actor.familyName}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Connexion rapide"
          description="Facultatif : se connecter avec la reconnaissance de ton telephone au lieu du mot de passe."
        />
        <CardBody>
          <PasskeyManager
            passkeys={passkeys.map((passkey) => ({
              id: passkey.id,
              nickname: passkey.nickname,
              createdAtLabel: formatDate(passkey.createdAt, actor.timeZone),
              lastUsedAtLabel:
                passkey.lastUsedAt !== null ? formatDate(passkey.lastUsedAt, actor.timeZone) : null,
            }))}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Se deconnecter" />
        <CardBody>
          <LogoutButton />
        </CardBody>
      </Card>
    </div>
  );
};

export default ChildProfilePage;
