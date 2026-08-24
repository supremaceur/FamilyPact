'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SelectField, TextField } from '@/components/ui/field';
import { StepUpPrompt } from '@/components/security/step-up-prompt';
import { apiDelete, apiPut } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

const TIME_ZONES = [
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Luxembourg',
  'America/Montreal',
  'Indian/Reunion',
  'America/Guadeloupe',
  'UTC',
];

export const FamilySettingsForm = ({
  name,
  timeZone,
  canEdit,
  canDelete,
}: {
  readonly name: string;
  readonly timeZone: string;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}) => {
  const action = useAction();
  const deletion = useAction();
  const [values, setValues] = useState({ name, timeZone });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmationName, setConfirmationName] = useState('');
  const [needsStepUp, setNeedsStepUp] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(() => apiPut('/api/family/settings', values), {
            successNotice: 'Parametres enregistres.',
          });
        }}
      >
        {action.error !== null && <Alert tone="error">{action.error}</Alert>}
        {action.notice !== null && <Alert tone="success">{action.notice}</Alert>}

        <TextField
          label="Nom de la famille"
          required
          disabled={!canEdit}
          value={values.name}
          error={action.fieldErrors.name?.[0]}
          onChange={(event) => {
            setValues((current) => ({ ...current, name: event.target.value }));
          }}
        />
        <SelectField
          label="Fuseau horaire"
          disabled={!canEdit}
          hint="Toutes les echeances et tous les horaires de l'historique s'y referent."
          options={TIME_ZONES.map((zone) => ({ value: zone, label: zone }))}
          value={values.timeZone}
          error={action.fieldErrors.timeZone?.[0]}
          onChange={(event) => {
            setValues((current) => ({ ...current, timeZone: event.target.value }));
          }}
        />
        {canEdit && (
          <Button type="submit" pending={action.pending}>
            Enregistrer
          </Button>
        )}
      </form>

      {canDelete && (
        <div className="border-t border-[var(--border-subtle)] pt-5">
          <h3 className="text-clay-700 dark:text-clay-200 text-sm font-semibold">
            Supprimer la famille
          </h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Efface definitivement la famille, tous les comptes enfants et l&apos;integralite des
            donnees : taches, points, recompenses et sanctions. Irreversible.
          </p>
          {deletion.error !== null && (
            <Alert tone="error" className="mt-3">
              {deletion.error}
            </Alert>
          )}
          {needsStepUp && (
            <div className="mt-3">
              <StepUpPrompt
                onVerified={() => {
                  setNeedsStepUp(false);
                  deletion.reset();
                }}
              />
            </div>
          )}
          <Button
            variant="danger"
            size="sm"
            className="mt-3"
            onClick={() => {
              setConfirmationName('');
              setConfirmingDelete(true);
            }}
          >
            Supprimer la famille
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title="Supprimer definitivement cette famille ?"
        confirmLabel="Supprimer"
        confirmVariant="danger"
        pending={deletion.pending}
        onCancel={() => {
          setConfirmingDelete(false);
        }}
        onConfirm={() => {
          void deletion
            .run(() => apiDelete('/api/family/settings', { confirmationName }), {
              refresh: false,
              onSuccess: () => {
                window.location.assign('/');
              },
            })
            .then((result) => {
              if (result === null) {
                setConfirmingDelete(false);
                setNeedsStepUp(true);
              }
            });
        }}
      >
        <div className="space-y-3">
          <p>
            Tous les comptes enfants seront supprimes. Les comptes parents subsisteront mais
            perdront l&apos;acces a cette famille.
          </p>
          <TextField
            label={`Saisissez « ${name} » pour confirmer`}
            value={confirmationName}
            onChange={(event) => {
              setConfirmationName(event.target.value);
            }}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
};
