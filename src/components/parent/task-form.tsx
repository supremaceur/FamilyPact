'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { WEEKDAY_LABELS, WEEKDAY_SHORT_LABELS } from '@/domain/tasks';
import { apiPost, apiPut } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

export interface TaskFormValues {
  readonly childMembershipId: string;
  readonly title: string;
  readonly description: string;
  readonly pointsAward: number;
  readonly pointsPenalty: number;
  readonly recurrence: 'ONE_OFF' | 'DAILY' | 'WEEKLY_DAYS';
  readonly startDate: string;
  readonly endDate: string;
  readonly dueTime: string;
  readonly weekdays: readonly number[];
}

const RECURRENCE_OPTIONS = [
  { value: 'ONE_OFF', label: 'Une seule fois' },
  { value: 'DAILY', label: 'Tous les jours' },
  { value: 'WEEKLY_DAYS', label: 'Certains jours de la semaine' },
];

/**
 * Formulaire de tache.
 *
 * Un avertissement explicite rappelle qu'une modification ne reecrit pas le
 * passe : les occurrences deja creees gardent leur libelle et leurs points.
 * C'est une regle metier, pas un detail technique — elle doit etre visible.
 */
export const TaskForm = ({
  children,
  initial,
  taskId,
}: {
  readonly children: readonly { readonly id: string; readonly displayName: string }[];
  readonly initial?: TaskFormValues;
  readonly taskId?: string;
}) => {
  const router = useRouter();
  const action = useAction();
  const [values, setValues] = useState<TaskFormValues>(
    initial ?? {
      childMembershipId: children[0]?.id ?? '',
      title: '',
      description: '',
      pointsAward: 10,
      pointsPenalty: 0,
      recurrence: 'DAILY',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      dueTime: '19:00',
      weekdays: [1, 2, 3, 4, 5],
    },
  );

  const update = <K extends keyof TaskFormValues>(key: K, value: TaskFormValues[K]): void => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = async (): Promise<void> => {
    const payload = {
      childMembershipId: values.childMembershipId,
      title: values.title,
      description: values.description.trim().length > 0 ? values.description.trim() : null,
      pointsAward: values.pointsAward,
      pointsPenalty: values.pointsPenalty,
      recurrence: values.recurrence,
      startDate: values.startDate,
      endDate: values.endDate.length > 0 ? values.endDate : null,
      dueTime: values.dueTime,
      weekdays: values.recurrence === 'WEEKLY_DAYS' ? [...values.weekdays] : [],
    };

    await action.run(
      () =>
        taskId === undefined
          ? apiPost('/api/tasks', payload)
          : apiPut(`/api/tasks/${taskId}`, payload),
      {
        refresh: false,
        onSuccess: () => {
          router.push('/parent/taches');
          router.refresh();
        },
      },
    );
  };

  if (children.length === 0) {
    return (
      <Alert tone="warning" title="Aucun enfant dans la famille">
        Invitez d&apos;abord un enfant : une tache est toujours attribuee a quelqu&apos;un.
      </Alert>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}

      <SelectField
        label="Pour quel enfant"
        required
        options={children.map((child) => ({ value: child.id, label: child.displayName }))}
        value={values.childMembershipId}
        error={action.fieldErrors.childMembershipId?.[0]}
        onChange={(event) => {
          update('childMembershipId', event.target.value);
        }}
      />

      <TextField
        label="Titre"
        required
        maxLength={120}
        placeholder="Ranger la chambre"
        value={values.title}
        error={action.fieldErrors.title?.[0]}
        onChange={(event) => {
          update('title', event.target.value);
        }}
      />

      <TextAreaField
        label="Description"
        hint="Facultatif. Precisez ce qui est attendu, pour eviter les malentendus."
        maxLength={1000}
        value={values.description}
        onChange={(event) => {
          update('description', event.target.value);
        }}
      />

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Points si validee"
          type="number"
          min={0}
          max={10000}
          required
          value={String(values.pointsAward)}
          error={action.fieldErrors.pointsAward?.[0]}
          onChange={(event) => {
            update('pointsAward', Number.parseInt(event.target.value, 10) || 0);
          }}
        />
        <TextField
          label="Points si non realisee"
          type="number"
          min={0}
          max={10000}
          required
          hint="Retire uniquement si vous le confirmez."
          value={String(values.pointsPenalty)}
          error={action.fieldErrors.pointsPenalty?.[0]}
          onChange={(event) => {
            update('pointsPenalty', Number.parseInt(event.target.value, 10) || 0);
          }}
        />
      </div>

      <SelectField
        label="Frequence"
        required
        options={RECURRENCE_OPTIONS}
        value={values.recurrence}
        onChange={(event) => {
          update('recurrence', event.target.value as TaskFormValues['recurrence']);
        }}
      />

      {values.recurrence === 'WEEKLY_DAYS' && (
        <fieldset>
          <legend className="text-sm font-medium text-[var(--text-secondary)]">
            Jours concernes
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, index) => {
              const day = index + 1;
              const selected = values.weekdays.includes(day);
              return (
                <label
                  key={label}
                  className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border px-3 text-sm ${
                    selected
                      ? 'border-pact-600 bg-pact-600 text-white'
                      : 'border-[var(--border-strong)] text-[var(--text-secondary)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selected}
                    onChange={(event) => {
                      update(
                        'weekdays',
                        event.target.checked
                          ? [...values.weekdays, day].sort((a, b) => a - b)
                          : values.weekdays.filter((value) => value !== day),
                      );
                    }}
                  />
                  <span aria-hidden="true">{WEEKDAY_SHORT_LABELS[index]}</span>
                  <span className="sr-only">{label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={values.recurrence === 'ONE_OFF' ? 'Date' : "Date d'effet"}
          type="date"
          required
          value={values.startDate}
          error={action.fieldErrors.startDate?.[0]}
          onChange={(event) => {
            update('startDate', event.target.value);
          }}
        />
        <TextField
          label="Heure limite"
          type="time"
          required
          hint="Exprimee dans le fuseau horaire de la famille."
          value={values.dueTime}
          error={action.fieldErrors.dueTime?.[0]}
          onChange={(event) => {
            update('dueTime', event.target.value);
          }}
        />
      </div>

      {values.recurrence !== 'ONE_OFF' && (
        <TextField
          label="Date de fin"
          type="date"
          hint="Facultatif. Laissez vide pour une tache sans fin."
          value={values.endDate}
          error={action.fieldErrors.endDate?.[0]}
          onChange={(event) => {
            update('endDate', event.target.value);
          }}
        />
      )}

      {taskId !== undefined && (
        <Alert tone="info">
          Les occurrences deja creees ne changent pas : elles conservent le libelle et les points
          annonces au moment ou elles ont ete generees. Seules les occurrences futures encore a
          faire seront regenerees.
        </Alert>
      )}

      <Button type="submit" size="lg" fullWidth pending={action.pending}>
        {taskId === undefined ? 'Creer la tache' : 'Enregistrer les modifications'}
      </Button>
    </form>
  );
};
