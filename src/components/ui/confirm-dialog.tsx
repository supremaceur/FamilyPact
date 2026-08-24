'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button, type ButtonVariant } from './button';

/**
 * Boite de confirmation pour les decisions a consequence.
 *
 * Elle sert a rendre la consequence VISIBLE avant l'action :
 * « Lucas recevra +20 points. Score : 180 → 200. »
 *
 * Reserve aux decisions qui touchent aux points, aux sanctions ou a la
 * composition de la famille. Les actions anodines ne sont pas confirmees : une
 * confirmation systematique n'est plus lue.
 *
 * Implementee avec `<dialog>` natif : gestion du focus, de la touche Echap et
 * du fond inerte assuree par le navigateur.
 */
export const ConfirmDialog = ({
  open,
  title,
  children,
  confirmLabel,
  confirmVariant = 'primary',
  cancelLabel = 'Annuler',
  pending = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly confirmVariant?: ButtonVariant;
  readonly cancelLabel?: string;
  readonly pending?: boolean;
  /**
   * Confirmation bloquee tant qu'une saisie obligatoire manque. Distinct de
   * `pending` : le bouton est inerte, mais il n'annonce pas un envoi en cours.
   */
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-0 text-[var(--text-primary)] shadow-[var(--shadow-lifted)] backdrop:bg-black/40"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-3 text-sm text-[var(--text-secondary)]">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            pending={pending}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
};
