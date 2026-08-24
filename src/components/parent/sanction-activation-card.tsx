'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SelectField, TextField } from '@/components/ui/field';
import { LIFT_CONDITION_LABELS } from '@/domain/rules-engine';
import type { ChildIdentityView } from '@/lib/read-models';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

type LiftType = 'MANUAL' | 'DATE' | 'SCORE' | 'DATE_AND_SCORE' | 'DATE_OR_SCORE';

const LIFT_OPTIONS = (Object.keys(LIFT_CONDITION_LABELS) as LiftType[]).map((key) => ({
  value: key,
  label: LIFT_CONDITION_LABELS[key],
}));

/**
 * Activation d'une sanction proposee.
 *
 * Le parent voit tout ce qui a conduit a la proposition — nom, enfant, seuil,
 * score au moment du franchissement — puis choisit lui-meme la condition de
 * levee. Cette condition est FIGEE sur l'episode : modifier la regle plus tard
 * ne changera pas une sanction deja en cours.
 */
export const SanctionActivationCard = ({
  instanceId,
  title,
  description,
  child,
  threshold,
  comparator,
  scoreAtProposal,
  currentScore,
  defaults,
}: {
  readonly instanceId: string;
  readonly title: string;
  readonly description: string | null;
  readonly child: ChildIdentityView;
  readonly threshold: number;
  readonly comparator: 'LT' | 'LTE';
  readonly scoreAtProposal: number;
  readonly currentScore: number;
  readonly defaults: {
    readonly liftConditionType: LiftType;
    readonly liftScoreThreshold: number | null;
    readonly liftDurationDays: number | null;
  };
}) => {
  const action = useAction();
  const [confirming, setConfirming] = useState<'activate' | 'ignore' | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const [lift, setLift] = useState({
    liftConditionType: defaults.liftConditionType,
    liftScoreThreshold: defaults.liftScoreThreshold ?? '',
    liftDurationDays: defaults.liftDurationDays ?? '',
    liftAt: '',
  });

  const needsScore = ['SCORE', 'DATE_AND_SCORE', 'DATE_OR_SCORE'].includes(lift.liftConditionType);
  const needsDate = ['DATE', 'DATE_AND_SCORE', 'DATE_OR_SCORE'].includes(lift.liftConditionType);

  const activate = async (): Promise<void> => {
    const result = await action.run<{ alreadyDecided?: boolean }>(
      () =>
        apiPost(`/api/sanctions/instances/${instanceId}`, {
          action: 'activate',
          activation: {
            liftConditionType: lift.liftConditionType,
            liftScoreThreshold:
              needsScore && lift.liftScoreThreshold !== '' ? Number(lift.liftScoreThreshold) : null,
            liftDurationDays:
              needsDate && lift.liftAt === '' && lift.liftDurationDays !== ''
                ? Number(lift.liftDurationDays)
                : null,
            liftAt: needsDate && lift.liftAt !== '' ? new Date(lift.liftAt).toISOString() : null,
          },
        }),
      {
        onSuccess: (value) => {
          setConfirming(null);
          setSettled(
            value.alreadyDecided === true
              ? 'Cette sanction avait deja ete traitee par un autre parent.'
              : 'Sanction activee.',
          );
        },
      },
    );
    if (result === null) setConfirming(null);
  };

  const ignore = async (): Promise<void> => {
    const result = await action.run<{ alreadyDecided?: boolean }>(
      () => apiPost(`/api/sanctions/instances/${instanceId}`, { action: 'ignore' }),
      {
        onSuccess: (value) => {
          setConfirming(null);
          setSettled(
            value.alreadyDecided === true
              ? 'Cette sanction avait deja ete traitee par un autre parent.'
              : "Proposition ignoree. Aucune sanction n'a ete activee.",
          );
        },
      },
    );
    if (result === null) setConfirming(null);
  };

  return (
    <li className="border-b border-[var(--border-subtle)] py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <Avatar avatarKey={child.avatarKey} colorKey={child.colorKey} name={child.displayName} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{child.displayName}</p>
          {description !== null && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
          )}
          <p className="tabular mt-2 text-sm text-[var(--text-secondary)]">
            Declenchee parce que le score est passe {comparator === 'LTE' ? '≤' : '<'} {threshold}{' '}
            (score au franchissement : {scoreAtProposal} · score actuel : {currentScore})
          </p>
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
        <>
          <div className="mt-4 flex flex-col gap-3 pl-14">
            <SelectField
              label="Condition de levee"
              hint="Elle sera figee sur cette sanction. Dans tous les cas, la levee demandera votre validation."
              options={LIFT_OPTIONS}
              value={lift.liftConditionType}
              onChange={(event) => {
                setLift((current) => ({
                  ...current,
                  liftConditionType: event.target.value as LiftType,
                }));
              }}
            />
            {needsScore && (
              <TextField
                label="Score a atteindre"
                type="number"
                value={String(lift.liftScoreThreshold)}
                onChange={(event) => {
                  setLift((current) => ({ ...current, liftScoreThreshold: event.target.value }));
                }}
              />
            )}
            {needsDate && (
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Jusqu'a une date precise"
                  type="datetime-local"
                  hint="Prioritaire sur la duree."
                  value={lift.liftAt}
                  onChange={(event) => {
                    setLift((current) => ({ ...current, liftAt: event.target.value }));
                  }}
                />
                <TextField
                  label="Ou duree en jours"
                  type="number"
                  min={1}
                  value={String(lift.liftDurationDays)}
                  onChange={(event) => {
                    setLift((current) => ({ ...current, liftDurationDays: event.target.value }));
                  }}
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 pl-14">
            <Button
              variant="danger"
              size="sm"
              disabled={action.pending}
              onClick={() => {
                setConfirming('activate');
              }}
            >
              Activer la sanction
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={action.pending}
              onClick={() => {
                setConfirming('ignore');
              }}
            >
              Ignorer
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirming === 'activate'}
        title="Activer cette sanction ?"
        confirmLabel="Activer"
        confirmVariant="danger"
        pending={action.pending}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => void activate()}
      >
        <p>
          « {title} » deviendra active pour {child.displayName} et apparaitra dans son espace.
        </p>
        <p className="mt-2 text-[var(--text-muted)]">
          Condition de levee : {LIFT_CONDITION_LABELS[lift.liftConditionType]}. FamiliPact ne bloque
          aucun appareil : la mise en oeuvre reste de votre ressort.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === 'ignore'}
        title="Ignorer cette proposition ?"
        confirmLabel="Ignorer"
        pending={action.pending}
        onCancel={() => {
          setConfirming(null);
        }}
        onConfirm={() => void ignore()}
      >
        <p>
          Aucune sanction ne sera activee. Si le score remonte au-dessus du seuil puis repasse en
          dessous, une nouvelle proposition pourra apparaitre.
        </p>
      </ConfirmDialog>
    </li>
  );
};
