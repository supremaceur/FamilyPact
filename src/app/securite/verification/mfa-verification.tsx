'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

/**
 * Second facteur d'une session en attente.
 *
 * Le repli par code de recuperation est volontairement place en retrait : c'est
 * un dernier recours, et chaque code consomme reduit la marge du parent.
 */
export const MfaVerification = () => {
  const router = useRouter();
  const action = useAction();
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const submit = async (): Promise<void> => {
    await action.run(
      () =>
        apiPost('/api/auth/mfa/verify', {
          code,
          method: useRecoveryCode ? 'recovery' : 'totp',
        }),
      {
        refresh: false,
        onSuccess: () => {
          router.replace('/parent');
        },
      },
    );
  };

  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}

      {useRecoveryCode ? (
        <TextField
          key="recovery"
          label="Code de secours"
          name="recoveryCode"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
          hint="Chaque code de secours ne fonctionne qu'une seule fois."
          className="font-numeric tracking-wider"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
      ) : (
        <TextField
          key="totp"
          label="Code de verification"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          className="font-numeric text-lg tracking-[0.4em]"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, ''));
          }}
        />
      )}

      <Button type="submit" size="lg" fullWidth pending={action.pending}>
        Verifier
      </Button>

      <button
        type="button"
        className="text-sm text-[var(--text-muted)] underline underline-offset-4"
        onClick={() => {
          setUseRecoveryCode((current) => !current);
          setCode('');
          action.reset();
        }}
      >
        {useRecoveryCode
          ? 'Revenir au code de mon application'
          : "Je n'ai pas acces a mon application d'authentification"}
      </button>
    </form>
  );
};
