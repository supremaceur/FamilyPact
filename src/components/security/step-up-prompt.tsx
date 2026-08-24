'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

/**
 * Re-authentification avant une operation sensible (step-up).
 *
 * Elle ouvre une fenetre courte pendant laquelle le serveur accepte les
 * operations reservees : ajout d'un parent, changement de permissions,
 * transfert de propriete, regeneration des codes, suppression de la famille.
 */
export const StepUpPrompt = ({ onVerified }: { readonly onVerified: () => void }) => {
  const action = useAction();
  const [code, setCode] = useState('');

  const verify = async (): Promise<void> => {
    await action.run(() => apiPost('/api/auth/step-up', { method: 'totp', code }), {
      refresh: false,
      onSuccess: onVerified,
    });
  };

  const verifyWithPasskey = async (): Promise<void> => {
    await action.run(
      async () => {
        const { startAuthentication } = await import('@simplewebauthn/browser');
        const options = await apiPost<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
          '/api/auth/passkeys/authenticate',
          { identifier: null },
        );
        const assertion = await startAuthentication({ optionsJSON: options });
        return apiPost('/api/auth/step-up', {
          method: 'passkey',
          response: assertion,
          expectedChallenge: options.challenge,
        });
      },
      { refresh: false, onSuccess: onVerified },
    );
  };

  return (
    <div className="border-amber-soft-200 bg-amber-soft-50 dark:border-amber-soft-700 dark:bg-amber-soft-900/25 rounded-[var(--radius-card)] border p-4">
      <h2 className="text-amber-soft-900 dark:text-amber-soft-100 text-sm font-semibold">
        Verification requise
      </h2>
      <p className="text-amber-soft-900/85 dark:text-amber-soft-100/85 mt-1 text-sm">
        Cette action est sensible. Confirmez votre identite pour continuer.
      </p>

      {action.error !== null && (
        <Alert tone="error" className="mt-3">
          {action.error}
        </Alert>
      )}

      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void verify();
        }}
      >
        <TextField
          label="Code de votre application d'authentification"
          name="stepUpCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          className="font-numeric tracking-[0.4em]"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, ''));
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" pending={action.pending}>
            Confirmer
          </Button>
          <Button
            variant="secondary"
            onClick={() => void verifyWithPasskey()}
            disabled={action.pending}
          >
            Utiliser une cle d&apos;acces
          </Button>
        </div>
      </form>
    </div>
  );
};
