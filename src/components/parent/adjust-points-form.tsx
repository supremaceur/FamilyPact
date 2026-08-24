'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

/**
 * Ajustement manuel du score.
 *
 * Le motif est obligatoire — verifie cote serveur ET par une contrainte SQL.
 * Une cle d'idempotence est generee a l'ouverture du formulaire : un double
 * envoi du meme ajustement ne cree qu'une seule transaction.
 */
export const AdjustPointsForm = ({
  children,
}: {
  readonly children: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly score: number;
  }[];
}) => {
  const action = useAction();
  const [values, setValues] = useState({
    childMembershipId: children[0]?.id ?? '',
    delta: 0,
    reason: '',
  });
  const [confirming, setConfirming] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const child = children.find((candidate) => candidate.id === values.childMembershipId);

  const submit = async (): Promise<void> => {
    await action.run(
      () =>
        apiPost('/api/points/adjust', {
          childMembershipId: values.childMembershipId,
          delta: values.delta,
          reason: values.reason.trim(),
          idempotencyKey,
        }),
      {
        successNotice: 'Ajustement enregistre.',
        onSuccess: () => {
          setConfirming(false);
          setValues((current) => ({ ...current, delta: 0, reason: '' }));
          // Nouvelle cle pour l'ajustement suivant.
          setIdempotencyKey(crypto.randomUUID());
        },
      },
    );
  };

  if (children.length === 0) {
    return <Alert tone="info">Aucun enfant dans la famille.</Alert>;
  }

  return (
    <>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setConfirming(true);
        }}
      >
        {action.error !== null && <Alert tone="error">{action.error}</Alert>}
        {action.notice !== null && <Alert tone="success">{action.notice}</Alert>}

        <SelectField
          label="Enfant"
          required
          options={children.map((candidate) => ({
            value: candidate.id,
            label: `${candidate.displayName} (${candidate.score} points)`,
          }))}
          value={values.childMembershipId}
          onChange={(event) => {
            setValues((current) => ({ ...current, childMembershipId: event.target.value }));
          }}
        />
        <TextField
          label="Mouvement de points"
          type="number"
          required
          hint="Positif pour crediter, negatif pour retirer. Zero n'est pas accepte."
          value={String(values.delta)}
          error={action.fieldErrors.delta?.[0]}
          onChange={(event) => {
            setValues((current) => ({
              ...current,
              delta: Number.parseInt(event.target.value, 10) || 0,
            }));
          }}
        />
        <TextAreaField
          label="Motif"
          required
          hint="Obligatoire. Visible par l'enfant et conserve dans le journal d'audit."
          value={values.reason}
          error={action.fieldErrors.reason?.[0]}
          onChange={(event) => {
            setValues((current) => ({ ...current, reason: event.target.value }));
          }}
        />
        <Button type="submit" disabled={values.delta === 0 || values.reason.trim().length < 3}>
          Ajuster le score
        </Button>
      </form>

      <ConfirmDialog
        open={confirming}
        title="Confirmer cet ajustement ?"
        confirmLabel="Confirmer"
        confirmVariant={values.delta < 0 ? 'danger' : 'primary'}
        pending={action.pending}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => void submit()}
      >
        {child !== undefined && (
          <>
            <p>
              {child.displayName} {values.delta > 0 ? 'recevra' : 'perdra'}{' '}
              <strong className="tabular">{Math.abs(values.delta)} points</strong>.
            </p>
            <p className="tabular mt-2">
              Score : <strong>{child.score}</strong> <span aria-hidden="true">→</span>{' '}
              <strong>{child.score + values.delta}</strong>
            </p>
            <p className="mt-2 text-[var(--text-muted)]">Motif : {values.reason.trim()}</p>
          </>
        )}
      </ConfirmDialog>
    </>
  );
};
