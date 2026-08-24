'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TextAreaField } from '@/components/ui/field';
import { ProgressBar } from '@/components/ui/progress';
import type { ChildIdentityView } from '@/lib/read-models';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

/**
 * Sanction en cours : suivi de la condition de levee, puis levee.
 *
 * Meme lorsque la condition est atteinte, la sanction ne se leve pas seule :
 * elle passe en « levee possible » et attend une decision. Le parent peut aussi
 * lever a tout moment — son autorite prime sur la condition automatique.
 */
export const SanctionLiftCard = ({
  instanceId,
  title,
  description,
  child,
  status,
  liftConditionType,
  liftAt,
  liftScoreThreshold,
  currentScore,
  activatedAtLabel,
  liftAtLabel,
  canLift,
}: {
  readonly instanceId: string;
  readonly title: string;
  readonly description: string | null;
  readonly child: ChildIdentityView;
  readonly status: 'ACTIVE' | 'LIFT_ELIGIBLE';
  readonly liftConditionType: string;
  readonly liftAt: string | null;
  readonly liftScoreThreshold: number | null;
  readonly currentScore: number;
  readonly activatedAtLabel: string | null;
  readonly liftAtLabel: string | null;
  readonly canLift: boolean;
}) => {
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [settled, setSettled] = useState<string | null>(null);

  const lift = async (): Promise<void> => {
    const result = await action.run<{ alreadyDecided?: boolean }>(
      () =>
        apiPost(`/api/sanctions/instances/${instanceId}`, {
          action: 'lift',
          ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        }),
      {
        onSuccess: (value) => {
          setConfirming(false);
          setSettled(
            value.alreadyDecided === true
              ? 'Cette sanction avait deja ete levee.'
              : 'Sanction levee.',
          );
        },
      },
    );
    if (result === null) setConfirming(false);
  };

  return (
    <li className="border-b border-[var(--border-subtle)] py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <Avatar avatarKey={child.avatarKey} colorKey={child.colorKey} name={child.displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{title}</p>
            <Badge tone={status === 'LIFT_ELIGIBLE' ? 'pending' : 'negative'}>
              {status === 'LIFT_ELIGIBLE' ? 'Levee possible' : 'Active'}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            {child.displayName}
            {activatedAtLabel !== null && <> · active depuis le {activatedAtLabel}</>}
          </p>
          {description !== null && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
          )}

          <div className="mt-3 space-y-2 text-sm">
            {liftConditionType === 'MANUAL' && (
              <p className="text-[var(--text-secondary)]">
                Levee manuelle : vous decidez quand y mettre fin.
              </p>
            )}
            {liftScoreThreshold !== null && (
              <div>
                <div className="tabular flex items-baseline justify-between gap-3">
                  <span className="text-[var(--text-secondary)]">Score a atteindre</span>
                  <span className="text-[var(--text-muted)]">
                    {currentScore} / {liftScoreThreshold}
                  </span>
                </div>
                <ProgressBar
                  className="mt-1.5"
                  value={currentScore}
                  max={liftScoreThreshold}
                  label={`Progression de ${child.displayName} vers la levee de ${title}`}
                />
              </div>
            )}
            {liftAt !== null && liftAtLabel !== null && (
              <p className="text-[var(--text-secondary)]">Fin prevue : {liftAtLabel}</p>
            )}
          </div>

          {status === 'LIFT_ELIGIBLE' && (
            <Alert tone="warning" className="mt-3">
              Condition de levee atteinte — votre validation est requise. La sanction reste active
              tant que vous ne l&apos;avez pas levee.
            </Alert>
          )}
        </div>
      </div>

      {action.error !== null && (
        <Alert tone="error" className="mt-3">
          {action.error}
        </Alert>
      )}
      {settled !== null && (
        <Alert tone="success" className="mt-3">
          {settled}
        </Alert>
      )}

      {settled === null && canLift && (
        <div className="mt-3 pl-14">
          <Button
            variant="approve"
            size="sm"
            disabled={action.pending}
            onClick={() => {
              setConfirming(true);
            }}
          >
            Lever la sanction
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Lever cette sanction ?"
        confirmLabel="Lever"
        confirmVariant="approve"
        pending={action.pending}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => void lift()}
      >
        <div className="space-y-3">
          <p>
            « {title} » prendra fin pour {child.displayName}. La date de levee et votre nom seront
            enregistres dans l&apos;historique.
          </p>
          <TextAreaField
            label="Message pour l'enfant"
            hint="Facultatif."
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </div>
      </ConfirmDialog>
    </li>
  );
};
