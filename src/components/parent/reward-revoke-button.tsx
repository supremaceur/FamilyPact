'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TextAreaField } from '@/components/ui/field';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

/**
 * Retrait d'une recompense qui durait, depuis l'historique des paliers.
 *
 * Volontairement DISCRET — un lien, pas un bouton plein. Ce n'est pas une
 * action courante, et une interface qui met le retrait en avant pousse a
 * retirer. La carte « Recompenses a revoir » porte, elle, l'arbitrage complet
 * (retirer ou laisser) quand le score est repasse sous le palier ; ici, le
 * parent agit de sa propre initiative.
 *
 * Le motif est obligatoire : l'enfant doit savoir pourquoi. La confirmation
 * reste inerte tant qu'il est vide, plutot que de laisser decouvrir l'exigence
 * apres coup.
 */
export const RewardRevokeButton = ({
  rewardEventId,
  title,
  childName,
  score,
}: {
  readonly rewardEventId: string;
  readonly title: string;
  readonly childName: string;
  readonly score: number;
}) => {
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [motif, setMotif] = useState('');
  const [settled, setSettled] = useState<string | null>(null);

  if (settled !== null) {
    return (
      <Alert tone="success" className="mt-2">
        {settled}
      </Alert>
    );
  }

  const submit = async (): Promise<void> => {
    const result = await action.run<{ alreadyDecided?: boolean }>(
      () =>
        apiPost(`/api/rewards/events/${rewardEventId}`, { action: 'revoke', note: motif.trim() }),
      {
        onSuccess: (value) => {
          setOpen(false);
          setSettled(
            value.alreadyDecided === true
              ? 'Cette recompense avait deja ete retiree par un autre parent.'
              : 'Recompense retiree.',
          );
        },
      },
    );
    if (result === null) setOpen(false);
  };

  return (
    <>
      {action.error !== null && (
        <Alert tone="error" className="mt-2">
          {action.error}
        </Alert>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 -ml-3"
        disabled={action.pending}
        onClick={() => {
          setMotif('');
          setOpen(true);
        }}
      >
        Retirer la recompense
      </Button>

      {open && (
        <ConfirmDialog
          open
          title="Retirer cette recompense ?"
          confirmLabel="Retirer la recompense"
          confirmVariant="danger"
          pending={action.pending}
          confirmDisabled={motif.trim().length === 0}
          onCancel={() => {
            setOpen(false);
          }}
          onConfirm={() => void submit()}
        >
          <div className="space-y-3">
            <p>
              {childName} perd «&nbsp;{title}&nbsp;». Le motif que vous indiquez lui sera montre.
            </p>
            <p className="text-[var(--text-muted)]">
              Aucun point n&apos;est retire ni rendu : le score reste a {score}. Le palier ne sera
              pas repropose.
            </p>
            <TextAreaField
              label="Message pour l'enfant"
              hint="Obligatoire. Il sera visible dans son historique."
              required
              value={motif}
              onChange={(event) => {
                setMotif(event.target.value);
              }}
            />
          </div>
        </ConfirmDialog>
      )}
    </>
  );
};
