import type { ReactNode } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';

/**
 * Coquille des ecrans publics.
 * Colonne etroite centree : l'attention doit rester sur un seul formulaire.
 */
const PublicLayout = ({ children }: { readonly children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col">
    <header className="px-5 pt-6">
      <Link href="/" className="inline-block rounded-[var(--radius-control)]">
        <Wordmark />
      </Link>
    </header>
    <main id="contenu" className="mx-auto w-full max-w-md flex-1 px-5 py-8">
      {children}
    </main>
    <footer className="px-5 pb-8 text-center text-xs text-[var(--text-muted)]">
      <p>FamiliPact ne bloque aucun appareil et ne localise personne.</p>
      <p className="mt-1">L&apos;application informe et propose : le parent decide.</p>
    </footer>
  </div>
);

export default PublicLayout;
