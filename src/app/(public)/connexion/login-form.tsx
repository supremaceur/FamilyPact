'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { apiPost, apiPut } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

interface LoginResponse {
  readonly nextStep: 'MFA_ENROLLMENT' | 'MFA_VERIFICATION' | 'READY';
  readonly userKind: 'ADULT' | 'CHILD';
}

const DESTINATION: Record<LoginResponse['nextStep'], string> = {
  MFA_ENROLLMENT: '/securite/configuration',
  MFA_VERIFICATION: '/securite/verification',
  READY: '/',
};

export const LoginForm = () => {
  const router = useRouter();
  const action = useAction();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passkeySupported] = useState(
    () => typeof window !== 'undefined' && 'PublicKeyCredential' in window,
  );

  const submit = async (): Promise<void> => {
    await action.run(() => apiPost<LoginResponse>('/api/auth/login', { identifier, password }), {
      refresh: false,
      onSuccess: (result) => {
        router.replace(DESTINATION[result.nextStep]);
      },
    });
  };

  /**
   * Connexion par cle d'acces (Face ID, Touch ID, Windows Hello…).
   * Le navigateur declenche la biometrie : l'application ne voit qu'une
   * signature WebAuthn, jamais une donnee biometrique.
   */
  const submitPasskey = async (): Promise<void> => {
    await action.run(
      async () => {
        const { startAuthentication } = await import('@simplewebauthn/browser');
        const options = await apiPost<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
          '/api/auth/passkeys/authenticate',
          { identifier: identifier.trim().length > 0 ? identifier : null },
        );
        const assertion = await startAuthentication({ optionsJSON: options });
        return apiPut<LoginResponse>('/api/auth/passkeys/authenticate', {
          response: assertion,
          expectedChallenge: options.challenge,
        });
      },
      {
        refresh: false,
        onSuccess: (result) => {
          router.replace(DESTINATION[result.nextStep]);
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

      <TextField
        label="E-mail ou identifiant"
        name="identifier"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        value={identifier}
        onChange={(event) => {
          setIdentifier(event.target.value);
        }}
      />
      <TextField
        label="Mot de passe"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
      />

      <Button type="submit" size="lg" fullWidth pending={action.pending}>
        Se connecter
      </Button>

      {passkeySupported && (
        <>
          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-[var(--border-subtle)]" />
            <span className="text-xs text-[var(--text-muted)]">ou</span>
            <span className="h-px flex-1 bg-[var(--border-subtle)]" />
          </div>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={() => void submitPasskey()}
            disabled={action.pending}
          >
            Utiliser une cle d&apos;acces
          </Button>
          <p className="text-center text-xs text-[var(--text-muted)]">
            Face ID, Touch ID, Windows Hello ou biometrie Android, selon votre appareil.
          </p>
        </>
      )}
    </form>
  );
};
