import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SessionStatus, UserKind } from '@/generated/prisma/enums';
import { TotpEnrollment } from './totp-enrollment';
import { getCurrentSession } from '@/server/auth/context';

export const metadata: Metadata = { title: 'Configurer la double authentification' };

/**
 * Enrolement TOTP — etape obligatoire pour tout compte parent.
 *
 * Tant qu'elle n'est pas terminee, la session reste en
 * PENDING_MFA_ENROLLMENT et aucune donnee familiale n'est lisible.
 */
const TotpSetupPage = async () => {
  const session = await getCurrentSession();
  if (session === null) redirect('/connexion');
  if (session.user.kind !== UserKind.ADULT) redirect('/enfant');
  if (session.status === SessionStatus.PENDING_MFA) redirect('/securite/verification');

  const alreadyEnrolled = session.status === SessionStatus.ACTIVE && session.user.hasConfirmedTotp;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {alreadyEnrolled ? 'Remplacer votre double authentification' : 'Securiser votre compte'}
      </h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        {alreadyEnrolled
          ? 'Vous allez remplacer votre configuration actuelle. Vos anciens codes de secours seront invalides.'
          : 'Cette etape est obligatoire pour les comptes parents. Elle empeche qu’un mot de passe seul suffise a modifier les points ou les sanctions de votre famille.'}
      </p>
      <TotpEnrollment alreadyEnrolled={alreadyEnrolled} />
    </div>
  );
};

export default TotpSetupPage;
