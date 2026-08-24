import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RegisterForm } from './register-form';
import { getCurrentSession } from '@/server/auth/context';
import { landingDestinationFor } from '@/server/auth/routing';

export const metadata: Metadata = { title: 'Creer ma famille' };

const RegisterPage = async () => {
  const session = await getCurrentSession();
  if (session !== null) redirect(await landingDestinationFor(session));

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Creer ma famille</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Vous devenez proprietaire de la famille. Vous pourrez ensuite inviter un autre parent et vos
        enfants.
      </p>
      <RegisterForm />
      <p className="mt-6 text-sm text-[var(--text-muted)]">
        Vous avez recu un code d&apos;invitation ?{' '}
        <Link
          href="/rejoindre"
          className="text-pact-700 dark:text-pact-300 font-medium underline underline-offset-4"
        >
          Rejoindre une famille
        </Link>
      </p>
    </div>
  );
};

export default RegisterPage;
