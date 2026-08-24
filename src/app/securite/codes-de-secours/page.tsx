import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RegenerateRecoveryCodes } from './regenerate';
import { getCurrentSession } from '@/server/auth/context';
import { prisma } from '@/server/db/prisma';

export const metadata: Metadata = { title: 'Codes de secours' };

/**
 * Gestion des codes de secours.
 *
 * Le nombre de codes restants est affiche, mais jamais les codes eux-memes :
 * la base ne contient que leurs hashes.
 */
const RecoveryCodesPage = async () => {
  const session = await getCurrentSession();
  if (session === null) redirect('/connexion');

  const remaining = await prisma.recoveryCode.count({
    where: { userId: session.user.id, usedAt: null },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Codes de secours</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Ils permettent de vous connecter si vous perdez l&apos;acces a votre application
        d&apos;authentification.
      </p>
      <p className="mt-4 text-sm">
        <span className="tabular text-2xl font-semibold">{remaining}</span>{' '}
        <span className="text-[var(--text-muted)]">
          code{remaining > 1 ? 's' : ''} encore utilisable{remaining > 1 ? 's' : ''}
        </span>
      </p>
      <RegenerateRecoveryCodes />
    </div>
  );
};

export default RecoveryCodesPage;
