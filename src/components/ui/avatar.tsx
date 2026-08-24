import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Avatar d'enfant.
 *
 * Aucune photo n'est stockee : l'avatar est un pictogramme embarque, choisi
 * parmi un jeu fixe. C'est un choix de protection des donnees, pas une
 * limitation technique (voir docs/privacy.md).
 *
 * Chaque figure est composee de formes simples plutot que d'un trace unique :
 * a 32 pixels, une silhouette lisible vaut mieux qu'un dessin detaille qui
 * devient une tache. Les proportions sont volontairement rondes et calmes —
 * l'application s'adresse a des enfants sans etre infantilisante.
 */
const GLYPHS: Record<string, ReactNode> = {
  fox: (
    <>
      <path d="M5 7.5 7 4l3.2 2.2h3.6L17 4l2 3.5v4.2a7 7 0 0 1-14 0Z" />
      <circle cx="9.4" cy="11" r="1.05" fill="var(--surface-raised, #fff)" />
      <circle cx="14.6" cy="11" r="1.05" fill="var(--surface-raised, #fff)" />
      <path
        d="M12 14.2a1.5 1.5 0 0 0 1.4-1h-2.8a1.5 1.5 0 0 0 1.4 1Z"
        fill="var(--surface-raised, #fff)"
      />
    </>
  ),
  owl: (
    <>
      <path d="M6 6.5 8.4 4l1.4 2.2h4.4L15.6 4 18 6.5v6a6 6 0 0 1-12 0Z" />
      <circle cx="9.5" cy="10.5" r="2.1" fill="var(--surface-raised, #fff)" />
      <circle cx="14.5" cy="10.5" r="2.1" fill="var(--surface-raised, #fff)" />
      <circle cx="9.5" cy="10.5" r="0.85" />
      <circle cx="14.5" cy="10.5" r="0.85" />
    </>
  ),
  otter: (
    <>
      <path d="M12 4c3.6 0 6.2 2.6 6.2 6v3.4A5.6 5.6 0 0 1 12.6 19h-1.2a5.6 5.6 0 0 1-5.6-5.6V10c0-3.4 2.6-6 6.2-6Z" />
      <circle cx="9.6" cy="10.4" r="1" fill="var(--surface-raised, #fff)" />
      <circle cx="14.4" cy="10.4" r="1" fill="var(--surface-raised, #fff)" />
      <ellipse cx="12" cy="13.4" rx="2.4" ry="1.7" fill="var(--surface-raised, #fff)" />
      <circle cx="12" cy="12.7" r="0.8" />
    </>
  ),
  hedgehog: (
    <>
      <path d="M12 3.4 13.5 6l2.7-1.2-.5 2.9 2.9.4-1.9 2.2 2.3 1.8-2.7 1.1 1 2.8-2.9-.4-.4 2.9-2.4-1.7-2.4 1.7-.4-2.9-2.9.4 1-2.8L4.2 12l2.3-1.8-1.9-2.2 2.9-.4-.5-2.9L9.7 6Z" />
      <circle cx="10.4" cy="11.2" r="0.95" fill="var(--surface-raised, #fff)" />
      <circle cx="13.6" cy="11.2" r="0.95" fill="var(--surface-raised, #fff)" />
    </>
  ),
  whale: (
    <>
      <path d="M3.4 12.4c0-3.5 3.6-6.2 8.2-6.2s8.2 2.7 8.2 6.2c0 3.4-3.4 6-7.8 6.2l-4.5 1.3 1-3.4a6.3 6.3 0 0 1-5.1-4.1Z" />
      <path d="M11.6 6.2c.3-1.4 1-2.4 2-2.9-.4 1.1-.4 2 0 2.9Z" />
      <circle cx="8.6" cy="11.6" r="1" fill="var(--surface-raised, #fff)" />
    </>
  ),
  cat: (
    <>
      <path d="M5 4.4 8.6 7.4h6.8L19 4.4v7.8a7 7 0 0 1-14 0Z" />
      <circle cx="9.5" cy="11.2" r="1.05" fill="var(--surface-raised, #fff)" />
      <circle cx="14.5" cy="11.2" r="1.05" fill="var(--surface-raised, #fff)" />
      <path
        d="M4.6 13.4h3M4.6 15.1h3M16.4 13.4h3M16.4 15.1h3"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinecap="round"
        fill="none"
      />
    </>
  ),
  panda: (
    <>
      <circle cx="6.9" cy="6.6" r="2.7" />
      <circle cx="17.1" cy="6.6" r="2.7" />
      <circle cx="12" cy="13" r="7" />
      <ellipse cx="9.3" cy="11.9" rx="1.9" ry="2.2" fill="var(--surface-raised, #fff)" />
      <ellipse cx="14.7" cy="11.9" rx="1.9" ry="2.2" fill="var(--surface-raised, #fff)" />
      <circle cx="9.3" cy="12.1" r="0.85" />
      <circle cx="14.7" cy="12.1" r="0.85" />
    </>
  ),
  bear: (
    <>
      <circle cx="6.6" cy="7" r="2.9" />
      <circle cx="17.4" cy="7" r="2.9" />
      <circle cx="12" cy="13.2" r="6.8" />
      <circle cx="9.6" cy="11.9" r="1" fill="var(--surface-raised, #fff)" />
      <circle cx="14.4" cy="11.9" r="1" fill="var(--surface-raised, #fff)" />
      <ellipse cx="12" cy="15" rx="2.6" ry="1.9" fill="var(--surface-raised, #fff)" />
      <ellipse cx="12" cy="14.2" rx="1.1" ry="0.85" />
    </>
  ),
};

const COLOR_CLASSES: Record<string, string> = {
  sage: 'bg-pact-100 text-pact-700 dark:bg-pact-900 dark:text-pact-200',
  lagoon: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  amber: 'bg-amber-soft-100 text-amber-soft-900 dark:bg-amber-soft-900/40 dark:text-amber-soft-100',
  clay: 'bg-clay-100 text-clay-700 dark:bg-clay-900/40 dark:text-clay-100',
  lilac: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  slate: 'bg-sand-200 text-sand-800 dark:bg-sand-800 dark:text-sand-100',
};

export const Avatar = ({
  avatarKey,
  colorKey,
  name,
  size = 'md',
}: {
  readonly avatarKey: string;
  readonly colorKey: string;
  readonly name: string;
  readonly size?: 'sm' | 'md' | 'lg';
}) => {
  const sizeClass = size === 'sm' ? 'size-8' : size === 'lg' ? 'size-14' : 'size-11';
  const figure = GLYPHS[avatarKey] ?? GLYPHS.fox;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        sizeClass,
        COLOR_CLASSES[colorKey] ?? COLOR_CLASSES.sage,
      )}
    >
      {/* Le nom est deja affiche a cote : le pictogramme est purement decoratif. */}
      <svg viewBox="0 0 24 24" className="size-[72%]" fill="currentColor" aria-hidden="true">
        {figure}
      </svg>
      <span className="sr-only">{name}</span>
    </span>
  );
};

export { COLOR_CLASSES as AVATAR_COLOR_CLASSES };
