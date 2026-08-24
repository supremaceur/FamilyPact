'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { StepUpPrompt } from '@/components/security/step-up-prompt';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

interface CreatedInvitation {
  readonly id: string;
  readonly formattedCode: string;
  readonly joinUrl: string;
  readonly targetRole: string;
  readonly expiresAt: string;
}

/**
 * Creation d'une invitation.
 *
 * Le code n'est affiche qu'une seule fois : seul son hash est conserve. Le QR
 * code est genere cote client a partir du lien, sans appel reseau.
 */
export const InvitationPanel = ({
  allowedRoles,
}: {
  readonly allowedRoles: readonly { readonly value: string; readonly label: string }[];
}) => {
  const action = useAction();
  const [role, setRole] = useState(allowedRoles[0]?.value ?? 'CHILD');
  const [label, setLabel] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(72);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async (): Promise<void> => {
    const result = await action.run(
      () =>
        apiPost<CreatedInvitation>('/api/invitations', {
          targetRole: role,
          label: label.trim().length > 0 ? label.trim() : null,
          expiresInHours,
        }),
      {
        onSuccess: (value) => {
          setCreated(value);
          setNeedsStepUp(false);
          // Le QR code est genere localement, sans appel reseau : le code
          // d'invitation ne quitte jamais l'appareil du parent.
          void import('uqr').then(({ renderSVG }) => {
            setQrSvg(renderSVG(value.joinUrl, { border: 1 }));
          });
        },
      },
    );
    // Inviter un adulte est une operation sensible : le serveur peut exiger
    // une re-authentification recente.
    if (result === null && action.error !== null && role !== 'CHILD') setNeedsStepUp(true);
  };

  const copy = async (): Promise<void> => {
    if (created === null) return;
    try {
      await navigator.clipboard.writeText(created.formattedCode);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2_500);
    } catch {
      setCopied(false);
    }
  };

  if (created !== null) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title="Invitation creee">
          Ce code ne sera plus jamais affiche. Transmettez-le maintenant.
        </Alert>

        <div className="rounded-[var(--radius-card)] border border-[var(--border-strong)] p-4">
          <p className="text-xs text-[var(--text-muted)]">Code a saisir</p>
          <p className="font-numeric mt-1 text-lg tracking-wider break-all select-all">
            {created.formattedCode}
          </p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void copy()}>
            {copied ? 'Code copie' : 'Copier le code'}
          </Button>
        </div>

        {qrSvg !== null && (
          <div className="rounded-[var(--radius-card)] border border-[var(--border-strong)] p-4">
            <p className="text-xs text-[var(--text-muted)]">Ou scanner ce QR code</p>
            <div
              className="mt-2 w-fit rounded-[var(--radius-control)] bg-white p-2"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
              role="img"
              aria-label="QR code d'invitation"
            />
          </div>
        )}

        <p className="text-xs text-[var(--text-muted)]">
          Utilisable une seule fois. Expire le {new Date(created.expiresAt).toLocaleString('fr-FR')}
          . Vous pouvez le revoquer avant utilisation depuis la liste ci-dessous.
        </p>

        <Button
          variant="secondary"
          onClick={() => {
            setCreated(null);
            setQrSvg(null);
          }}
        >
          Creer une autre invitation
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {needsStepUp && (
        <StepUpPrompt
          onVerified={() => {
            setNeedsStepUp(false);
            void create();
          }}
        />
      )}

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        {action.error !== null && <Alert tone="error">{action.error}</Alert>}

        <SelectField
          label="Type de compte"
          options={allowedRoles}
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
          }}
        />
        <TextField
          label="Pour qui"
          hint="Facultatif. Une note pour vous aider a reconnaitre l'invitation."
          placeholder="Lucas"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
          }}
        />
        <TextField
          label="Validite (heures)"
          type="number"
          min={1}
          max={720}
          value={String(expiresInHours)}
          onChange={(event) => {
            setExpiresInHours(Number.parseInt(event.target.value, 10) || 72);
          }}
        />
        <Button type="submit" pending={action.pending}>
          Creer l&apos;invitation
        </Button>
      </form>
    </div>
  );
};
