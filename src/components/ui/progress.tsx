import type { CSSProperties, ReactNode } from 'react';
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

/**
 * Anneau de progression — espace enfant uniquement.
 *
 * Meme information que `ProgressBar`, plus de presence : c'est la piece
 * centrale de la direction « Halo ». Comme la barre, ce n'est PAS une mecanique
 * de jeu — pas de celebration au remplissage, pas de niveau, pas de serie.
 *
 * DEUX PRECAUTIONS, parce qu'un anneau se lit moins vite qu'une barre :
 *
 *   - le score occupe le centre, en grand, et le rappel chiffre
 *     (« 375 / 500 ») accompagne toujours l'anneau. « Combien il me reste »
 *     doit rester lisible sans interpreter un arc de cercle ;
 *   - le degrade conique est purement decoratif (`aria-hidden`) ; l'etat est
 *     porte par le `role="progressbar"` du conteneur, avec son `aria-valuetext`
 *     en toutes lettres.
 *
 * Rendu en CSS (`conic-gradient` + masque) plutot qu'en SVG : pas de chemin a
 * calculer, et la couleur suit les jetons de l'espace.
 */
export const ProgressRing = ({
  value,
  max,
  label,
  centre,
  legende,
  className,
}: {
  readonly value: number;
  readonly max: number;
  readonly label: string;
  /** Ce qui s'affiche au centre — le score, en general. */
  readonly centre: ReactNode;
  /** Une ligne courte sous le centre : l'unite, ou rien. */
  readonly legende?: ReactNode;
  readonly className?: string;
}) => {
  const safeMax = max > 0 ? max : 1;
  const clamped = Math.max(0, Math.min(value, safeMax));
  const turns = clamped / safeMax;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped} sur ${safeMax} points`}
      aria-label={label}
      className={cn('relative mx-auto grid size-44 place-content-center', className)}
    >
      <div
        aria-hidden="true"
        className="anneau absolute inset-0 rounded-full"
        style={{ '--anneau-part': `${turns}turn` } as CSSProperties}
      />
      <div className="relative text-center">
        <div className="tabular text-4xl leading-none font-semibold">{centre}</div>
        {legende !== undefined && (
          <div className="mt-1 text-xs text-[var(--text-muted)]">{legende}</div>
        )}
      </div>
    </div>
  );
};
