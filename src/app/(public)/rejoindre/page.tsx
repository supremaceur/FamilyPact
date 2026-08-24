import type { Metadata } from 'next';
import { JoinFlow } from './join-flow';

export const metadata: Metadata = { title: 'Rejoindre une famille' };

/**
 * Entree par code d'invitation.
 *
 * Le code peut arriver dans l'URL (QR code) ou etre saisi a la main. Il n'est
 * jamais consomme a cette etape : il ne l'est qu'au moment de la creation
 * effective du compte, dans la meme transaction.
 */
const JoinPage = async ({
  searchParams,
}: {
  readonly searchParams: Promise<{ code?: string }>;
}) => {
  const { code } = await searchParams;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Rejoindre une famille</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Saisis le code que tes parents t&apos;ont donne, ou scanne le QR code depuis leur telephone.
      </p>
      <JoinFlow initialCode={code ?? ''} />
    </div>
  );
};

export default JoinPage;
