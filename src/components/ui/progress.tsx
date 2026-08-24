import { cn } from '@/lib/cn';

/**
 * Barre de progression vers un palier.
 *
 * C'est une INFORMATION de progression, pas une mecanique de jeu : pas
 * d'animation de remplissage, pas de degrade clinquant, pas de celebration.
 * Le chiffre exact accompagne toujours la barre — la barre seule ne suffirait
 * pas a un lecteur d'ecran ni a un utilisateur daltonien.
 */
export const ProgressBar = ({
  value,
  max,
  label,
  className,
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  readonly className?: string;
}) => {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(value, safeMax));
  const percent = Math.round((clamped / safeMax) * 100);

  return (
    <div className={cn('w-full', className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={clamped}
        aria-valuetext={`${clamped} sur ${safeMax} points`}
        aria-label={label}
        className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      >
        <div
          className="bg-pact-500 dark:bg-pact-400 h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};
