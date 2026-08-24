'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

/** Fuseaux les plus courants ; la liste complete reste modifiable ensuite. */
const TIME_ZONES = [
  { value: 'Europe/Paris', label: 'Europe/Paris (France metropolitaine)' },
  { value: 'Europe/Brussels', label: 'Europe/Bruxelles' },
  { value: 'Europe/Zurich', label: 'Europe/Zurich' },
  { value: 'Europe/Luxembourg', label: 'Europe/Luxembourg' },
  { value: 'America/Montreal', label: 'Amerique/Montreal' },
  { value: 'Indian/Reunion', label: 'Ocean Indien/La Reunion' },
  { value: 'America/Guadeloupe', label: 'Amerique/Guadeloupe' },
  { value: 'UTC', label: 'UTC' },
];

export const RegisterForm = () => {
  const router = useRouter();
  const action = useAction();
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: '',
    familyName: '',
    timeZone: 'Europe/Paris',
  });

  const update = (key: keyof typeof form, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (): Promise<void> => {
    await action.run(() => apiPost('/api/auth/register', form), {
      refresh: false,
      onSuccess: () => {
        // La double authentification est obligatoire : on y va directement.
        router.replace('/securite/configuration');
      },
    });
  };

  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}

      <TextField
        label="Votre prenom"
        name="displayName"
        autoComplete="given-name"
        required
        value={form.displayName}
        error={action.fieldErrors.displayName?.[0]}
        onChange={(event) => {
          update('displayName', event.target.value);
        }}
      />
      <TextField
        label="Adresse e-mail"
        name="email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        required
        value={form.email}
        error={action.fieldErrors.email?.[0]}
        onChange={(event) => {
          update('email', event.target.value);
        }}
      />
      <TextField
        label="Mot de passe"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        hint="12 caracteres minimum. Une phrase facile a retenir vaut mieux qu'un mot complique."
        value={form.password}
        error={action.fieldErrors.password?.[0]}
        onChange={(event) => {
          update('password', event.target.value);
        }}
      />
      <TextField
        label="Nom de la famille"
        name="familyName"
        required
        hint="Par exemple : Famille Durand."
        value={form.familyName}
        error={action.fieldErrors.familyName?.[0]}
        onChange={(event) => {
          update('familyName', event.target.value);
        }}
      />
      <SelectField
        label="Fuseau horaire"
        name="timeZone"
        hint="Les echeances des taches seront exprimees dans ce fuseau."
        options={TIME_ZONES}
        value={form.timeZone}
        error={action.fieldErrors.timeZone?.[0]}
        onChange={(event) => {
          update('timeZone', event.target.value);
        }}
      />

      <Alert tone="info">
        A l&apos;etape suivante, vous configurerez une double authentification. Elle est obligatoire
        pour tous les comptes parents : elle protege le score et les decisions de votre famille.
      </Alert>

      <Button type="submit" size="lg" fullWidth pending={action.pending}>
        Creer ma famille
      </Button>
    </form>
  );
};
