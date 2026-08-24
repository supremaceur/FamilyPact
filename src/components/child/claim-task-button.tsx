'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

/**
 * Bouton « J'ai termine ».
 *
 * C'est la SEULE action qu'un enfant peut declencher. Elle ne credite aucun
 * point : elle place la tache en attente de validation parentale. Le libelle
 * et le message de confirmation le disent explicitement, pour ne pas laisser
 * croire que les points sont acquis.
 */
export const ClaimTaskButton = ({
  occurrenceId,
  points,
}: {
  readonly occurrenceId: string;
  readonly points: number;
}) => {
  const action = useAction();
  const [claimed, setClaimed] = useState(false);

  if (claimed) {
    return (
      <Alert tone="success" className="mt-3">
        C&apos;est note ! Un parent va verifier, puis les {points} points seront ajoutes.
      </Alert>
    );
  }

  return (
    <div className="mt-3">
      {action.error !== null && (
        <Alert tone="error" className="mb-2">
          {action.error}
        </Alert>
      )}
      <Button
        size="lg"
        fullWidth
        pending={action.pending}
        onClick={() =>
          void action.run(
            () => apiPost(`/api/occurrences/${occurrenceId}/decision`, { action: 'claim' }),
            {
              onSuccess: () => {
                setClaimed(true);
              },
            },
          )
        }
      >
        J&apos;ai termine
      </Button>
    </div>
  );
};
