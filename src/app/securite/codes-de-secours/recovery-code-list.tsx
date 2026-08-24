'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * Affichage des codes de secours.
 *
 * Ils ne sont montres qu'une seule fois : la base ne contient que leur hash
 * Argon2id. La copie et le telechargement sont proposes parce qu'un code
 * recopie a la main est une source d'erreur — et qu'un parent bloque hors de
 * son compte est un probleme de securite en soi.
 */
export const RecoveryCodeList = ({
  codes,
  className,
}: {
  readonly codes: readonly string[];
  readonly className?: string;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 2_500);
    } catch {
      // Le presse-papiers peut etre refuse : les codes restent lisibles a l'ecran.
      setCopied(false);
    }
  };

  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-[var(--border-strong)] p-4',
        className,
      )}
    >
      <ul className="font-numeric grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {codes.map((code) => (
          <li key={code} className="tracking-wide select-all">
            {code}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? 'Codes copies' : 'Copier les codes'}
        </Button>
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Chaque code ne fonctionne qu&apos;une fois. Rangez-les hors de cet appareil : dans un
        gestionnaire de mots de passe, ou sur papier dans un endroit sur.
      </p>
    </div>
  );
};
