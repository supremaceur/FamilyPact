'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';
import { StepUpPrompt } from '@/components/security/step-up-prompt';
import { RecoveryCodeList } from './recovery-code-list';

/**
 * Regeneration des codes de secours.
 *
 * Operation sensible : si le serveur repond STEP_UP_REQUIRED, une
 * re-authentification est demandee avant de reessayer.
 */
export const RegenerateRecoveryCodes = () => {
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [needsStepUp, setNeedsStepUp] = useState(false);

  const regenerate = async (): Promise<void> => {
    setConfirming(false);
    const result = await action.run(
      () => apiPost<{ recoveryCodes: string[] }>('/api/auth/mfa/recovery-codes'),
      { refresh: false, onSuccess: (value) => setCodes(value.recoveryCodes) },
    );
    if (result === null && action.error !== null) setNeedsStepUp(true);
  };

  if (codes !== null) {
    return (
      <div className="mt-6">
        <Alert tone="success" title="Nouveaux codes generes">
          Vos anciens codes ne fonctionnent plus. Conservez ceux-ci maintenant.
        </Alert>
        <RecoveryCodeList codes={codes} className="mt-5" />
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {action.error !== null && <Alert tone="error">{action.error}</Alert>}

      {needsStepUp && (
        <StepUpPrompt
          onVerified={() => {
            setNeedsStepUp(false);
            void regenerate();
          }}
        />
      )}

      <Button
        variant="secondary"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Generer de nouveaux codes
      </Button>

      <ConfirmDialog
        open={confirming}
        title="Generer de nouveaux codes de secours ?"
        confirmLabel="Generer"
        pending={action.pending}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => void regenerate()}
      >
        <p>
          Vos codes actuels seront <strong>immediatement invalides</strong>. Assurez-vous de pouvoir
          conserver les nouveaux avant de continuer.
        </p>
      </ConfirmDialog>
    </div>
  );
};
