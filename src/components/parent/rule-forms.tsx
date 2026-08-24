'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { LIFT_CONDITION_LABELS } from '@/domain/rules-engine';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

interface ChildOption {
  readonly id: string;
  readonly displayName: string;
}

/** Creation d'un palier de recompense. */
export const RewardRuleForm = ({ children }: { readonly children: readonly ChildOption[] }) => {
  const action = useAction();
  const [values, setValues] = useState({
    childMembershipId: children[0]?.id ?? '',
    threshold: 500,
    title: '',
    description: '',
  });

  const submit = async (): Promise<void> => {
    await action.run(
      () =>
        apiPost('/api/rewards/rules', {
          ...values,
          description: values.description.trim().length > 0 ? values.description.trim() : null,
        }),
      {
        successNotice: 'Palier cree.',
        onSuccess: () => {
          setValues((current) => ({ ...current, title: '', description: '' }));
        },
      },
    );
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}
      {action.notice !== null && <Alert tone="success">{action.notice}</Alert>}

      <SelectField
        label="Pour quel enfant"
        required
        options={children.map((child) => ({ value: child.id, label: child.displayName }))}
        value={values.childMembershipId}
        onChange={(event) => {
          setValues((current) => ({ ...current, childMembershipId: event.target.value }));
        }}
      />
      <TextField
        label="Recompense"
        required
        placeholder="Sortie cinema"
        value={values.title}
        error={action.fieldErrors.title?.[0]}
        onChange={(event) => {
          setValues((current) => ({ ...current, title: event.target.value }));
        }}
      />
      <TextField
        label="Palier a atteindre"
        type="number"
        min={1}
        required
        hint="Le palier ne consomme aucun point : le score continue de progresser."
        value={String(values.threshold)}
        error={action.fieldErrors.threshold?.[0]}
        onChange={(event) => {
          setValues((current) => ({
            ...current,
            threshold: Number.parseInt(event.target.value, 10) || 0,
          }));
        }}
      />
      <TextAreaField
        label="Precisions"
        hint="Facultatif."
        value={values.description}
        onChange={(event) => {
          setValues((current) => ({ ...current, description: event.target.value }));
        }}
      />
      <Button type="submit" pending={action.pending}>
        Creer le palier
      </Button>
    </form>
  );
};

const LIFT_OPTIONS = Object.entries(LIFT_CONDITION_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Creation d'une regle de sanction. */
export const SanctionRuleForm = ({ children }: { readonly children: readonly ChildOption[] }) => {
  const action = useAction();
  const [values, setValues] = useState({
    childMembershipId: children[0]?.id ?? '',
    threshold: 100,
    comparator: 'LT',
    title: '',
    description: '',
    liftConditionType: 'MANUAL',
    liftScoreThreshold: '',
    liftDurationDays: '',
  });

  const needsScore = ['SCORE', 'DATE_AND_SCORE', 'DATE_OR_SCORE'].includes(
    values.liftConditionType,
  );
  const needsDuration = ['DATE', 'DATE_AND_SCORE', 'DATE_OR_SCORE'].includes(
    values.liftConditionType,
  );

  const submit = async (): Promise<void> => {
    await action.run(
      () =>
        apiPost('/api/sanctions/rules', {
          childMembershipId: values.childMembershipId,
          threshold: values.threshold,
          comparator: values.comparator,
          title: values.title,
          description: values.description.trim().length > 0 ? values.description.trim() : null,
          liftConditionType: values.liftConditionType,
          liftScoreThreshold:
            needsScore && values.liftScoreThreshold !== ''
              ? Number(values.liftScoreThreshold)
              : null,
          liftDurationDays:
            needsDuration && values.liftDurationDays !== ''
              ? Number(values.liftDurationDays)
              : null,
        }),
      {
        successNotice: 'Regle creee.',
        onSuccess: () => {
          setValues((current) => ({ ...current, title: '', description: '' }));
        },
      },
    );
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}
      {action.notice !== null && <Alert tone="success">{action.notice}</Alert>}

      <SelectField
        label="Pour quel enfant"
        required
        options={children.map((child) => ({ value: child.id, label: child.displayName }))}
        value={values.childMembershipId}
        onChange={(event) => {
          setValues((current) => ({ ...current, childMembershipId: event.target.value }));
        }}
      />
      <TextField
        label="Sanction"
        required
        placeholder="Pas de sortie ce week-end"
        value={values.title}
        error={action.fieldErrors.title?.[0]}
        onChange={(event) => {
          setValues((current) => ({ ...current, title: event.target.value }));
        }}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Se declenche si le score est"
          options={[
            { value: 'LT', label: 'strictement inferieur a' },
            { value: 'LTE', label: 'inferieur ou egal a' },
          ]}
          value={values.comparator}
          onChange={(event) => {
            setValues((current) => ({ ...current, comparator: event.target.value }));
          }}
        />
        <TextField
          label="Seuil"
          type="number"
          required
          value={String(values.threshold)}
          error={action.fieldErrors.threshold?.[0]}
          onChange={(event) => {
            setValues((current) => ({
              ...current,
              threshold: Number.parseInt(event.target.value, 10) || 0,
            }));
          }}
        />
      </div>
      <SelectField
        label="Condition de levee proposee"
        hint="Vous pourrez l'ajuster au moment d'activer la sanction."
        options={LIFT_OPTIONS}
        value={values.liftConditionType}
        error={action.fieldErrors.liftConditionType?.[0]}
        onChange={(event) => {
          setValues((current) => ({ ...current, liftConditionType: event.target.value }));
        }}
      />
      {needsScore && (
        <TextField
          label="Score a atteindre pour lever"
          type="number"
          value={values.liftScoreThreshold}
          onChange={(event) => {
            setValues((current) => ({ ...current, liftScoreThreshold: event.target.value }));
          }}
        />
      )}
      {needsDuration && (
        <TextField
          label="Duree par defaut (jours)"
          type="number"
          min={1}
          value={values.liftDurationDays}
          onChange={(event) => {
            setValues((current) => ({ ...current, liftDurationDays: event.target.value }));
          }}
        />
      )}
      <TextAreaField
        label="Precisions"
        hint="Facultatif. Ce texte sera visible par l'enfant si la sanction est activee."
        value={values.description}
        onChange={(event) => {
          setValues((current) => ({ ...current, description: event.target.value }));
        }}
      />

      <Alert tone="info">
        Franchir le seuil ne declenche jamais la sanction : le systeme cree une proposition, que
        vous activez ou ignorez.
      </Alert>

      <Button type="submit" pending={action.pending}>
        Creer la regle
      </Button>
    </form>
  );
};
