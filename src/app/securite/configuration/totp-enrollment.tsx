'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { apiPost, apiPut } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';
import { RecoveryCodeList } from '../codes-de-secours/recovery-code-list';

interface Challenge {
  readonly otpauthUrl: string;
  readonly secretBase32: string;
  readonly qrCodeSvg: string;
}

/**
 * Enrolement TOTP en trois temps : generer, scanner, confirmer.
 *
 * Le QR code est un SVG genere par le serveur et rendu en ligne : aucun appel
 * a un service tiers, aucune image externe, donc compatible avec la CSP stricte
 * et sans fuite du secret vers un generateur distant.
 */
export const TotpEnrollment = ({ alreadyEnrolled }: { readonly alreadyEnrolled: boolean }) => {
  const router = useRouter();
  const action = useAction();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const begin = async (): Promise<void> => {
    await action.run(() => apiPost<Challenge>('/api/auth/mfa/totp'), {
      refresh: false,
      onSuccess: setChallenge,
    });
  };

  const confirm = async (): Promise<void> => {
    await action.run(() => apiPut<{ recoveryCodes: string[] }>('/api/auth/mfa/totp', { code }), {
      refresh: false,
      onSuccess: (result) => {
        setRecoveryCodes(result.recoveryCodes);
      },
    });
  };

  if (recoveryCodes !== null) {
    return (
      <div className="mt-6">
        <Alert tone="success" title="Double authentification activee">
          Conservez ces codes de secours maintenant : ils ne seront plus jamais affiches.
        </Alert>
        <RecoveryCodeList codes={recoveryCodes} className="mt-5" />
        <Button
          className="mt-6"
          size="lg"
          fullWidth
          onClick={() => {
            router.replace('/parent');
          }}
        >
          J&apos;ai conserve mes codes, continuer
        </Button>
      </div>
    );
  }

  if (challenge === null) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        {action.error !== null && <Alert tone="error">{action.error}</Alert>}
        <Alert tone="info" title="Ce dont vous avez besoin">
          Une application d&apos;authentification sur votre telephone : Google Authenticator,
          Microsoft Authenticator, Duo Mobile, ou le gestionnaire de mots de passe de votre choix.
        </Alert>
        <Button size="lg" fullWidth pending={action.pending} onClick={() => void begin()}>
          {alreadyEnrolled ? 'Generer un nouveau QR code' : 'Commencer'}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}

      <div>
        <h2 className="text-sm font-semibold">1. Scannez ce QR code</h2>
        <div
          className="mt-3 w-fit rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-white p-3"
          // Le SVG provient du serveur et n'inclut aucune donnee fournie par
          // l'utilisateur : il encode l'URI otpauth generee cote serveur.
          dangerouslySetInnerHTML={{ __html: challenge.qrCodeSvg }}
          role="img"
          aria-label="QR code de configuration de la double authentification"
        />
        <button
          type="button"
          className="text-pact-700 dark:text-pact-300 mt-3 text-sm font-medium underline underline-offset-4"
          onClick={() => {
            setShowSecret((current) => !current);
          }}
        >
          {showSecret ? 'Masquer la cle' : 'Impossible de scanner ? Afficher la cle'}
        </button>
        {showSecret && (
          <p className="font-numeric mt-2 text-sm break-all text-[var(--text-secondary)] select-all">
            {challenge.secretBase32}
          </p>
        )}
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm();
        }}
      >
        <div>
          <h2 className="text-sm font-semibold">2. Saisissez le code affiche</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Six chiffres, renouveles toutes les 30 secondes.
          </p>
        </div>
        <TextField
          label="Code de verification"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className="font-numeric text-lg tracking-[0.4em]"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, ''));
          }}
        />
        <Button type="submit" size="lg" fullWidth pending={action.pending}>
          Activer la double authentification
        </Button>
      </form>
    </div>
  );
};
