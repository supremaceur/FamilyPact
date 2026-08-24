'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

interface ResolvedInvitation {
  readonly familyName: string;
  readonly targetRole: 'OWNER' | 'ADMIN' | 'PARENT' | 'CHILD';
  readonly expiresAt: string;
  readonly suggestedLoginId: string | null;
}

/**
 * Parcours en deux temps : verifier le code, puis creer le compte.
 *
 * Le ROLE vient exclusivement du code : l'ecran de creation qui s'affiche
 * ensuite en decoule. Un code enfant ne peut donc jamais aboutir a un compte
 * parent, quelle que soit la requete envoyee.
 */
export const JoinFlow = ({ initialCode }: { readonly initialCode: string }) => {
  const router = useRouter();
  const action = useAction();
  const [code, setCode] = useState(initialCode);
  const [invitation, setInvitation] = useState<ResolvedInvitation | null>(null);
  const [childForm, setChildForm] = useState({ displayName: '', loginId: '', password: '' });
  const [parentForm, setParentForm] = useState({ displayName: '', email: '', password: '' });

  const verify = async (): Promise<void> => {
    await action.run(() => apiPost<ResolvedInvitation>('/api/auth/join/resolve', { code }), {
      refresh: false,
      onSuccess: (result) => {
        setInvitation(result);
      },
    });
  };

  const createChild = async (): Promise<void> => {
    await action.run(() => apiPost('/api/auth/join/child', { code, ...childForm }), {
      refresh: false,
      onSuccess: () => {
        router.replace('/enfant');
      },
    });
  };

  const createParent = async (): Promise<void> => {
    await action.run(() => apiPost('/api/auth/join/parent', { code, ...parentForm }), {
      refresh: false,
      onSuccess: () => {
        router.replace('/securite/configuration');
      },
    });
  };

  const suggestLoginId = async (displayName: string): Promise<void> => {
    if (displayName.trim().length === 0 || childForm.loginId.length > 0) return;
    const result = await apiPost<ResolvedInvitation>('/api/auth/join/resolve', {
      code,
      displayName,
    }).catch(() => null);
    if (result?.suggestedLoginId != null) {
      setChildForm((current) => ({ ...current, loginId: result.suggestedLoginId! }));
    }
  };

  if (invitation === null) {
    return (
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void verify();
        }}
      >
        {action.error !== null && <Alert tone="error">{action.error}</Alert>}
        <TextField
          label="Code d'invitation"
          name="code"
          required
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          hint="Les tirets et les majuscules n'ont pas d'importance."
          className="font-numeric tracking-wider"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
        />
        <Button type="submit" size="lg" fullWidth pending={action.pending}>
          Verifier le code
        </Button>
      </form>
    );
  }

  if (invitation.targetRole === 'CHILD') {
    return (
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void createChild();
        }}
      >
        <Alert tone="success" title={`Bienvenue dans « ${invitation.familyName} »`}>
          Choisis ton prenom, ton identifiant de connexion et ton mot de passe.
        </Alert>
        {action.error !== null && <Alert tone="error">{action.error}</Alert>}

        <TextField
          label="Ton prenom"
          name="displayName"
          required
          hint="C'est le nom que ta famille verra."
          value={childForm.displayName}
          error={action.fieldErrors.displayName?.[0]}
          onChange={(event) => {
            setChildForm((current) => ({ ...current, displayName: event.target.value }));
          }}
          onBlur={(event) => {
            void suggestLoginId(event.target.value);
          }}
        />
        <TextField
          label="Ton identifiant de connexion"
          name="loginId"
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          hint="Il sert uniquement a te connecter. Pas besoin d'adresse e-mail."
          value={childForm.loginId}
          error={action.fieldErrors.loginId?.[0]}
          onChange={(event) => {
            setChildForm((current) => ({ ...current, loginId: event.target.value }));
          }}
        />
        <TextField
          label="Ton mot de passe"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          hint="8 caracteres minimum."
          value={childForm.password}
          error={action.fieldErrors.password?.[0]}
          onChange={(event) => {
            setChildForm((current) => ({ ...current, password: event.target.value }));
          }}
        />
        <Button type="submit" size="lg" fullWidth pending={action.pending}>
          Rejoindre la famille
        </Button>
      </form>
    );
  }

  return (
    <form
      className="mt-6 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void createParent();
      }}
    >
      <Alert tone="success" title={`Invitation a rejoindre « ${invitation.familyName} »`}>
        Vous rejoindrez cette famille en tant que{' '}
        {invitation.targetRole === 'ADMIN' ? 'administrateur' : 'parent'}.
      </Alert>
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}

      <TextField
        label="Votre prenom"
        name="displayName"
        required
        value={parentForm.displayName}
        error={action.fieldErrors.displayName?.[0]}
        onChange={(event) => {
          setParentForm((current) => ({ ...current, displayName: event.target.value }));
        }}
      />
      <TextField
        label="Adresse e-mail"
        name="email"
        type="email"
        autoComplete="email"
        autoCapitalize="none"
        required
        value={parentForm.email}
        error={action.fieldErrors.email?.[0]}
        onChange={(event) => {
          setParentForm((current) => ({ ...current, email: event.target.value }));
        }}
      />
      <TextField
        label="Mot de passe"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        hint="12 caracteres minimum."
        value={parentForm.password}
        error={action.fieldErrors.password?.[0]}
        onChange={(event) => {
          setParentForm((current) => ({ ...current, password: event.target.value }));
        }}
      />

      <Alert tone="info">
        Vos droits de parent ne seront actifs qu&apos;une fois la double authentification
        configuree, a l&apos;etape suivante.
      </Alert>

      <Button type="submit" size="lg" fullWidth pending={action.pending}>
        Creer mon compte
      </Button>
    </form>
  );
};
