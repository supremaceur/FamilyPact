import type { ReactNode } from 'react';
import { Wordmark } from '@/components/brand/logo';

/**
 * Coquille des ecrans de securite (enrolement, verification, codes de secours).
 * Volontairement depouillee : aucune navigation vers l'espace familial n'est
 * proposee tant que l'authentification n'est pas complete.
 */
const SecurityLayout = ({ children }: { readonly children: ReactNode }) => (
  <div className="flex min-h-dvh flex-col">
    <header className="px-5 pt-6">
      <Wordmark />
    </header>
    <main id="contenu" className="mx-auto w-full max-w-md flex-1 px-5 py-8">
      {children}
    </main>
  </div>
);

export default SecurityLayout;
