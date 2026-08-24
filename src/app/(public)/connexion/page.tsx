import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LoginForm } from './login-form';
import { getCurrentSession } from '@/server/auth/context';
import { landingDestinationFor } from '@/server/auth/routing';

export const metadata: Metadata = { title: 'Connexion' };

const LoginPage = async () => {
  const session = await getCurrentSession();
  if (session !== null) redirect(await landingDestinationFor(session));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Se connecter</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Les parents se connectent avec leur adresse e-mail. Les enfants utilisent leur identifiant.
      </p>
      <LoginForm />
      <p className="mt-6 text-sm text-[var(--text-muted)]">
        Pas encore de famille ?{' '}
        <Link
          href="/creer-compte"
          className="text-pact-700 dark:text-pact-300 font-medium underline underline-offset-4"
        >
          En creer une
        </Link>
      </p>
    </div>
  );
};

export default LoginPage;
