'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TextField } from '@/components/ui/field';
import { apiDelete, apiPut } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

const AVATAR_KEYS = ['fox', 'owl', 'otter', 'hedgehog', 'whale', 'cat', 'panda', 'bear'] as const;
const COLOR_KEYS = ['sage', 'lagoon', 'amber', 'clay', 'lilac', 'slate'] as const;

const COLOR_LABELS: Record<string, string> = {
  sage: 'Vert sauge',
  lagoon: 'Bleu lagon',
  amber: 'Ambre',
  clay: 'Terre cuite',
  lilac: 'Lilas',
  slate: 'Ardoise',
};

/**
 * Profil d'un enfant.
 *
 * Les seules donnees modifiables sont le prenom, l'avatar et la couleur :
 * FamiliPact ne collecte ni adresse, ni ecole, ni telephone, ni localisation.
 * La suppression est un effacement reel, protege par la saisie du prenom.
 */
export const ChildProfileForm = ({
  childMembershipId,
  displayName,
  avatarKey,
  colorKey,
  canDelete,
}: {
  readonly childMembershipId: string;
  readonly displayName: string;
  readonly avatarKey: string;
  readonly colorKey: string;
  readonly canDelete: boolean;
}) => {
  const action = useAction();
  const deletion = useAction();
  const [values, setValues] = useState({ displayName, avatarKey, colorKey });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmationName, setConfirmationName] = useState('');

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(() => apiPut(`/api/children/${childMembershipId}`, values), {
            successNotice: 'Profil mis a jour.',
          });
        }}
      >
        {action.error !== null && <Alert tone="error">{action.error}</Alert>}
        {action.notice !== null && <Alert tone="success">{action.notice}</Alert>}

        <TextField
          label="Prenom affiche"
          required
          maxLength={40}
          hint="Distinct de l'identifiant de connexion, qui ne change pas."
          value={values.displayName}
          error={action.fieldErrors.displayName?.[0]}
          onChange={(event) => {
            setValues((current) => ({ ...current, displayName: event.target.value }));
          }}
        />

        <fieldset>
          <legend className="text-sm font-medium text-[var(--text-secondary)]">Avatar</legend>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Illustrations embarquees : aucune photo n&apos;est stockee.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {AVATAR_KEYS.map((key) => (
              <label
                key={key}
                className={`inline-flex size-14 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border ${
                  values.avatarKey === key
                    ? 'border-pact-600 ring-pact-600 ring-2'
                    : 'border-[var(--border-strong)]'
                }`}
              >
                <input
                  type="radio"
                  name="avatarKey"
                  className="sr-only"
                  checked={values.avatarKey === key}
                  onChange={() => {
                    setValues((current) => ({ ...current, avatarKey: key }));
                  }}
                />
                <Avatar avatarKey={key} colorKey={values.colorKey} name={key} />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-[var(--text-secondary)]">Couleur</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {COLOR_KEYS.map((key) => (
              <label
                key={key}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm ${
                  values.colorKey === key
                    ? 'border-pact-600 ring-pact-600 ring-2'
                    : 'border-[var(--border-strong)]'
                }`}
              >
                <input
                  type="radio"
                  name="colorKey"
                  className="sr-only"
                  checked={values.colorKey === key}
                  onChange={() => {
                    setValues((current) => ({ ...current, colorKey: key }));
                  }}
                />
                <Avatar avatarKey={values.avatarKey} colorKey={key} name={key} size="sm" />
                {COLOR_LABELS[key]}
              </label>
            ))}
          </div>
        </fieldset>

        <Button type="submit" pending={action.pending}>
          Enregistrer
        </Button>
      </form>

      {canDelete && (
        <div className="border-t border-[var(--border-subtle)] pt-5">
          <h3 className="text-clay-700 dark:text-clay-200 text-sm font-semibold">
            Supprimer ce profil
          </h3>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Efface definitivement le compte de {displayName}, ses taches, ses points, ses
            recompenses et ses sanctions. Cette action est irreversible.
          </p>
          {deletion.error !== null && (
            <Alert tone="error" className="mt-3">
              {deletion.error}
            </Alert>
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
            Supprimer definitivement
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={`Supprimer le profil de ${displayName} ?`}
        confirmLabel="Supprimer definitivement"
        confirmVariant="danger"
        pending={deletion.pending}
        onCancel={() => {
          setConfirmingDelete(false);
        }}
        onConfirm={() =>
          void deletion.run(
            () => apiDelete(`/api/children/${childMembershipId}`, { confirmationName }),
            {
              refresh: false,
              onSuccess: () => {
                window.location.assign('/parent/enfants');
              },
            },
          )
        }
      >
        <div className="space-y-3">
          <p>
            Toutes les donnees de {displayName} seront effacees : historique de points, taches,
            recompenses obtenues et sanctions. Il ne sera plus possible de se connecter avec son
            compte.
          </p>
          <TextField
            label={`Saisissez « ${displayName} » pour confirmer`}
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
