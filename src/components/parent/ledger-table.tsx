'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TextAreaField } from '@/components/ui/field';
import { apiPost } from '@/lib/api-client';
import { useAction } from '@/lib/use-action';

export interface LedgerRow {
  readonly id: string;
  readonly delta: number;
  readonly type: string;
  readonly label: string;
  readonly reason: string | null;
  readonly createdAtLabel: string;
  readonly childName: string;
  readonly approvedByName: string | null;
  readonly reversesTransactionId: string | null;
  readonly reversed: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  TASK_APPROVED: 'Tache validee',
  TASK_MISSED: 'Tache non realisee',
  MANUAL_ADJUSTMENT: 'Ajustement manuel',
  REVERSAL: 'Annulation',
};

/**
 * Historique des mouvements de points.
 *
 * Une transaction n'est jamais modifiee : l'annulation ajoute une ligne
 * inverse. L'erreur ET sa correction restent donc visibles cote a cote, avec
 * leur auteur, leur date et leur motif.
 */
export const LedgerTable = ({
  rows,
  canAdjust,
}: {
  readonly rows: readonly LedgerRow[];
  readonly canAdjust: boolean;
}) => {
  const action = useAction();
  const [target, setTarget] = useState<LedgerRow | null>(null);
  const [reason, setReason] = useState('');

  const reverse = async (): Promise<void> => {
    if (target === null) return;
    await action.run(
      () => apiPost('/api/points/reverse', { transactionId: target.id, reason: reason.trim() }),
      {
        onSuccess: () => {
          setTarget(null);
          setReason('');
        },
      },
    );
  };

  return (
    <>
      {action.error !== null && (
        <Alert tone="error" className="mb-3">
          {action.error}
        </Alert>
      )}

      <ul className="divide-y divide-[var(--border-subtle)]">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-3 py-3">
            <span
              className={`tabular w-14 shrink-0 text-right text-sm font-semibold ${
                row.delta > 0
                  ? 'text-leaf-700 dark:text-leaf-200'
                  : 'text-clay-700 dark:text-clay-200'
              }`}
            >
              {row.delta > 0 ? '+' : '−'}
              {Math.abs(row.delta)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{row.label}</p>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {row.createdAtLabel} · {row.childName} · {TYPE_LABELS[row.type] ?? row.type}
                {row.approvedByName !== null && <> · {row.approvedByName}</>}
              </p>
              {row.reason !== null && (
                <p className="mt-1 text-xs text-[var(--text-secondary)]">Motif : {row.reason}</p>
              )}
              {row.reversesTransactionId !== null && (
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Annule la transaction {row.reversesTransactionId.slice(0, 8)}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {row.reversed && <Badge tone="neutral">Annulee</Badge>}
              {canAdjust && !row.reversed && row.type !== 'REVERSAL' && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={action.pending}
                  onClick={() => {
                    setReason('');
                    setTarget(row);
                  }}
                >
                  Annuler
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={target !== null}
        title="Annuler cette transaction ?"
        confirmLabel="Annuler la transaction"
        confirmVariant="danger"
        cancelLabel="Revenir"
        pending={action.pending}
        onCancel={() => {
          setTarget(null);
        }}
        onConfirm={() => void reverse()}
      >
        {target !== null && (
          <div className="space-y-3">
            <p>
              Une transaction inverse de{' '}
              <strong className="tabular">
                {target.delta > 0 ? '−' : '+'}
                {Math.abs(target.delta)}
              </strong>{' '}
              sera ajoutee pour {target.childName}. La transaction d&apos;origine reste visible dans
              l&apos;historique : rien n&apos;est efface.
            </p>
            <TextAreaField
              label="Motif"
              required
              hint="Obligatoire. Il figurera dans l'historique et dans le journal d'audit."
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>
        )}
      </ConfirmDialog>
    </>
  );
};
