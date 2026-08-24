'use client';

import { useState, type ReactNode } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Alert } from '@/components/ui/alert';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TextAreaField } from '@/components/ui/field';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

export interface DecisionOption {
  readonly id: string;
  readonly label: string;
  readonly variant: ButtonVariant;
  readonly confirmTitle: string;
  /** Consequence exacte, affichee AVANT confirmation. */
  readonly consequence: ReactNode;
  readonly body: Record<string, unknown>;
  readonly requiresNote?: boolean;
}

/**
 * Carte de decision parentale.
 *
 * Regle d'UX centrale du produit : toute decision qui touche aux points affiche
 * sa consequence chiffree avant confirmation — « Lucas recevra +20 points.
 * Score : 180 → 200 ». Le parent ne decouvre jamais l'effet apres coup.
 *
 * Anti-erreur : le bouton se desactive pendant l'envoi, et le serveur est de
 * toute facon idempotent. Si un autre parent a decide entre-temps, la reponse
 * le dit explicitement plutot que d'echouer.
 */
export const DecisionCard = ({
  endpoint,
  title,
  subtitle,
  child,
  details,
  options,
}: {
  readonly endpoint: string;
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly child: {
    readonly displayName: string;
    readonly avatarKey: string;
    readonly colorKey: string;
  };
  readonly details?: ReactNode;
  readonly options: readonly DecisionOption[];
}) => {
  const action = useAction();
  const [active, setActive] = useState<DecisionOption | null>(null);
  const [note, setNote] = useState('');
  const [settled, setSettled] = useState<string | null>(null);

  const submit = async (option: DecisionOption): Promise<void> => {
    const result = await action.run<{ alreadyDecided?: boolean }>(
      () =>
        apiPost(endpoint, {
          ...option.body,
          ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        }),
      {
        onSuccess: (value) => {
          setActive(null);
          setSettled(
            value.alreadyDecided === true
              ? 'Cette decision avait deja ete prise par un autre parent.'
              : 'Decision enregistree.',
          );
        },
      },
    );
    if (result === null) setActive(null);
  };

  return (
    <li className="border-b border-[var(--border-subtle)] py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <Avatar avatarKey={child.avatarKey} colorKey={child.colorKey} name={child.displayName} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{child.displayName}</p>
          {subtitle !== undefined && (
            <div className="mt-1 text-sm text-[var(--text-secondary)]">{subtitle}</div>
          )}
          {details !== undefined && <div className="mt-2">{details}</div>}
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

      {settled === null && (
        <div className="mt-3 flex flex-wrap gap-2 pl-14">
          {options.map((option) => (
            <Button
              key={option.id}
              variant={option.variant}
              size="sm"
              disabled={action.pending}
              onClick={() => {
                setNote('');
                setActive(option);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

      {active !== null && (
        <ConfirmDialog
          open
          title={active.confirmTitle}
          confirmLabel={active.label}
          confirmVariant={active.variant}
          pending={action.pending}
          onCancel={() => {
            setActive(null);
          }}
          onConfirm={() => void submit(active)}
        >
          <div className="space-y-3">
            <div>{active.consequence}</div>
            {active.requiresNote === true && (
              <TextAreaField
                label="Message pour l'enfant"
                hint="Facultatif. Il sera visible dans son historique."
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </div>
        </ConfirmDialog>
      )}
    </li>
  );
};

/** Rendu commun d'une variation de score : « 180 → 200 ». */
export const ScorePreview = ({
  before,
  delta,
}: {
  readonly before: number;
  readonly delta: number;
}) => (
  <p className="tabular text-sm">
    Score : <strong>{before}</strong> <span aria-hidden="true">→</span>{' '}
    <span className="sr-only">devient</span>
    <strong>{before + delta}</strong>
  </p>
);
