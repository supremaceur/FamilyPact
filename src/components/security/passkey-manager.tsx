'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { apiDelete, apiPost, apiPut } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

export interface PasskeyRow {
  readonly id: string;
  readonly nickname: string;
  readonly createdAtLabel: string;
  readonly lastUsedAtLabel: string | null;
}

/**
 * Gestion des cles d'acces.
 *
 * L'enregistrement demande un authentificateur de PLATEFORME : c'est ce qui
 * declenche Face ID, Touch ID, Windows Hello ou la biometrie Android. Aucune
 * API biometrique proprietaire n'est appelee — le navigateur gere tout, et
 * l'application ne recoit qu'une signature.
 *
 * Ajouter ou supprimer une cle ne touche jamais au TOTP : la politique MFA du
 * compte parent reste inchangee.
 */
export const PasskeyManager = ({ passkeys }: { readonly passkeys: readonly PasskeyRow[] }) => {
  const action = useAction();
  const [nickname, setNickname] = useState('');
  const [supported] = useState(
    () => typeof window !== 'undefined' && 'PublicKeyCredential' in window,
  );

  const register = async (): Promise<void> => {
    await action.run(
      async () => {
        const { startRegistration } = await import('@simplewebauthn/browser');
        const options = await apiPost<Parameters<typeof startRegistration>[0]['optionsJSON']>(
          '/api/auth/passkeys/register',
        );
        const attestation = await startRegistration({ optionsJSON: options });
        return apiPut('/api/auth/passkeys/register', {
          response: attestation,
          expectedChallenge: options.challenge,
          nickname: nickname.trim().length > 0 ? nickname.trim() : 'Cet appareil',
        });
      },
      {
        successNotice: "Cle d'acces enregistree.",
        onSuccess: () => {
          setNickname('');
        },
      },
    );
  };

  if (!supported) {
    return (
      <Alert tone="info">
        Ce navigateur ne prend pas en charge les cles d&apos;acces. Votre double authentification
        par code reste disponible.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}
      {action.notice !== null && <Alert tone="success">{action.notice}</Alert>}

      {passkeys.length > 0 && (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{passkey.nickname}</p>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Ajoutee le {passkey.createdAtLabel}
                  {passkey.lastUsedAtLabel !== null && (
                    <> · derniere utilisation {passkey.lastUsedAtLabel}</>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={action.pending}
                onClick={() => void action.run(() => apiDelete(`/api/auth/passkeys/${passkey.id}`))}
              >
                Supprimer
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void register();
        }}
      >
        <TextField
          label="Nom de l'appareil"
          placeholder="iPhone de Marie"
          hint="Pour reconnaitre cette cle plus tard dans la liste."
          value={nickname}
          onChange={(event) => {
            setNickname(event.target.value);
          }}
        />
        <Button type="submit" variant="secondary" pending={action.pending}>
          Ajouter une cle d&apos;acces
        </Button>
      </form>

      <p className="text-xs text-[var(--text-muted)]">
        Une cle d&apos;acces utilise la reconnaissance de votre appareil (Face ID, Touch ID, Windows
        Hello, biometrie Android). Elle ne remplace pas votre double authentification par code :
        celle-ci reste exigee lors d&apos;une connexion par mot de passe.
      </p>
    </div>
  );
};
