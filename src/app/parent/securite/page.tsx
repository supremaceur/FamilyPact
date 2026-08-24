import type { Metadata } from 'next';
import { PageBody } from '@/components/layout/page-body';
import Link from 'next/link';
import { LogoutButton } from '@/components/security/logout-button';
import { PasskeyManager } from '@/components/security/passkey-manager';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatDate, formatDateTime } from '@/lib/format';
import { requireParentActor } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';
import { listPasskeys } from '@/server/services/passkeys';

export const metadata: Metadata = { title: 'Securite' };

/**
 * Securite du compte parent.
 *
 * La politique MFA est enoncee explicitement : le TOTP est obligatoire, la
 * passkey s'ajoute sans le remplacer, et reinitialiser le TOTP coupe l'acces
 * jusqu'a une nouvelle configuration.
 */
const SecurityPage = async () => {
  const actor = await requireParentActor();

  const [passkeys, recoveryCount, sessions] = await Promise.all([
    listPasskeys(actor.userId),
    prisma.recoveryCode.count({ where: { userId: actor.userId, usedAt: null } }),
    prisma.session.findMany({
      where: { userId: actor.userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: 10,
      select: { id: true, createdAt: true, lastSeenAt: true, authMethods: true, status: true },
    }),
  ]);

  return (
    <PageBody largeur="lecture" className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="Double authentification"
          description="Obligatoire pour tous les comptes parents."
        />
        <CardBody className="flex flex-col gap-4">
          <Alert tone="success" title="Active">
            Une connexion par mot de passe demande toujours votre code a 6 chiffres.
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Link href="/securite/codes-de-secours">
              <Button variant="secondary" size="sm">
                Codes de secours ({recoveryCount} restant{recoveryCount > 1 ? 's' : ''})
              </Button>
            </Link>
            <Link href="/securite/configuration">
              <Button variant="secondary" size="sm">
                Remplacer le QR code
              </Button>
            </Link>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Reinitialiser votre double authentification suspend immediatement votre acces a la
            famille : vous devrez en configurer une nouvelle avant de retrouver vos droits.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Cles d'acces"
          description="Face ID, Touch ID, Windows Hello ou biometrie Android, selon votre appareil."
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

      <Card>
        <CardHeader
          title="Sessions actives"
          description="Les adresses IP ne sont jamais conservees en clair : seule une empreinte est stockee."
        />
        <CardBody className="pt-0">
          <ul className="divide-y divide-[var(--border-subtle)]">
            {sessions.map((session) => (
              <li key={session.id} className="py-3 text-sm">
                <p>
                  {session.id === actor.session.id ? 'Cette session' : 'Autre appareil'}
                  <span className="ml-2 text-xs text-[var(--text-muted)]">
                    {session.authMethods.join(' + ')}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Ouverte le {formatDateTime(session.createdAt, actor.timeZone)} · vue le{' '}
                  {formatDateTime(session.lastSeenAt, actor.timeZone)}
                </p>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </PageBody>
  );
};

export default SecurityPage;
