'use client';

import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

/** Deconnexion : la session est revoquee cote serveur, pas seulement oubliee. */
export const LogoutButton = () => {
  const action = useAction();

  return (
    <Button
      variant="secondary"
      pending={action.pending}
      onClick={() =>
        void action.run(() => apiPost('/api/auth/logout'), {
          refresh: false,
          onSuccess: () => {
            window.location.assign('/connexion');
          },
        })
      }
    >
      Se deconnecter
    </Button>
  );
};
