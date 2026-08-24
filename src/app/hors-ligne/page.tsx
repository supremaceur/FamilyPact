import type { Metadata } from 'next';
import { Wordmark } from '@/components/brand/logo';

export const metadata: Metadata = { title: 'Hors ligne' };

/**
 * Page de repli hors connexion.
 *
 * Elle est volontairement vide de toute donnee familiale : c'est la seule page
 * applicative mise en cache, elle ne doit donc rien reveler.
 */
const OfflinePage = () => (
  <main
    id="contenu"
    className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
  >
    <Wordmark />
    <h1 className="text-xl font-semibold">Connexion indisponible</h1>
    <p className="text-sm text-[var(--text-secondary)]">
      FamiliPact a besoin d&apos;une connexion pour afficher les informations de votre famille et
      enregistrer vos decisions. Les donnees ne sont jamais conservees sur l&apos;appareil.
    </p>
    <p className="text-sm text-[var(--text-muted)]">
      Reconnectez-vous a Internet, puis rechargez la page.
    </p>
  </main>
);

export default OfflinePage;
