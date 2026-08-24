import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SessionStatus } from '@/generated/prisma/enums';
import { MfaVerification } from './mfa-verification';
import { getCurrentSession } from '@/server/auth/context';
import { landingDestinationFor } from '@/server/auth/routing';

export const metadata: Metadata = { title: 'Verification' };

const MfaVerificationPage = async () => {
  const session = await getCurrentSession();
  if (session === null) redirect('/connexion');
  if (session.status !== SessionStatus.PENDING_MFA) {
    redirect(await landingDestinationFor(session));
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Verification</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Saisissez le code a 6 chiffres affiche par votre application d&apos;authentification.
      </p>
      <MfaVerification />
    </div>
  );
};

export default MfaVerificationPage;
