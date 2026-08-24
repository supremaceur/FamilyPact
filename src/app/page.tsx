import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoMark, Wordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { getCurrentSession } from '@/server/auth/context';
import { landingDestinationFor } from '@/server/auth/routing';

/**
 * Accueil public.
 *
 * Un visiteur deja connecte est renvoye vers son espace : reafficher une page
 * de presentation a quelqu'un qui a une session ouverte n'a pas de sens.
 */
const HomePage = async () => {
  const session = await getCurrentSession();
  if (session !== null) redirect(await landingDestinationFor(session));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-5 pt-6">
        <Wordmark />
      </header>

      <main id="contenu" className="mx-auto w-full max-w-xl flex-1 px-5 py-10">
        <LogoMark className="text-pact-600 dark:text-pact-400 size-12" />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-balance">
          Les regles familiales, simplement.
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-[var(--text-secondary)]">
          FamiliPact aide votre famille a poser un cadre clair : des taches definies ensemble, des
          points qui progressent, des recompenses et des sanctions decidees par les parents.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/creer-compte" className="sm:flex-1">
            <Button size="lg" fullWidth>
              Creer ma famille
            </Button>
          </Link>
          <Link href="/connexion" className="sm:flex-1">
            <Button size="lg" variant="secondary" fullWidth>
              Se connecter
            </Button>
          </Link>
        </div>

        <Link
          href="/rejoindre"
          className="text-pact-700 dark:text-pact-300 mt-4 inline-block text-sm font-medium underline underline-offset-4"
        >
          J&apos;ai un code d&apos;invitation
        </Link>

        <section className="mt-12 space-y-5 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--text-muted)] uppercase">
            Ce que FamiliPact fait — et ne fait pas
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">Ce que l&apos;application fait</p>
              <ul className="mt-2 space-y-1.5 text-sm text-[var(--text-secondary)]">
                <li>Elle calcule les points a partir des taches validees.</li>
                <li>Elle signale les echeances depassees.</li>
                <li>Elle propose une recompense quand un palier est atteint.</li>
                <li>Elle garde une trace complete de chaque decision.</li>
              </ul>
            </div>
            <div>
              <p className="text-sm font-medium">Ce qu&apos;elle ne fait pas</p>
              <ul className="mt-2 space-y-1.5 text-sm text-[var(--text-secondary)]">
                <li>Elle ne bloque aucun telephone ni aucune application.</li>
                <li>Elle ne localise pas les enfants.</li>
                <li>Elle n&apos;applique jamais une sanction toute seule.</li>
                <li>Elle n&apos;accorde jamais une recompense sans votre accord.</li>
              </ul>
            </div>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            L&apos;application calcule, informe et propose. Le parent decide.
          </p>
        </section>
      </main>
    </div>
  );
};

export default HomePage;
