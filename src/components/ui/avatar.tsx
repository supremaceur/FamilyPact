import { cn } from '@/lib/cn';

/**
 * Avatar d'enfant.
 *
 * Aucune photo n'est stockee : l'avatar est un pictogramme embarque, choisi
 * parmi un jeu fixe. C'est un choix de protection des donnees, pas une
 * limitation technique (voir docs/privacy.md).
 */
const GLYPHS: Record<string, string> = {
  fox: 'M12 3 8 7h8l-4-4Zm-7 5h14l-1.5 10a2 2 0 0 1-2 1.8H8.5a2 2 0 0 1-2-1.8L5 8Z',
  owl: 'M12 3a9 9 0 0 0-9 9v3a6 6 0 0 0 6 6h6a6 6 0 0 0 6-6v-3a9 9 0 0 0-9-9Zm-3 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
  otter:
    'M12 2c4 0 7 3 7 7v6a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5V9c0-4 3-7 7-7Zm-2 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm4 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  hedgehog: 'M12 2 9 6l-4-1 2 4-4 2 4 2-2 4 4-1 3 4 3-4 4 1-2-4 4-2-4-2 2-4-4 1-3-4Z',
  whale: 'M3 12c0-4 4-7 9-7s9 3 9 7-4 7-9 7c-2 0-4-.5-5.5-1.4L3 20l1-4.4A6.6 6.6 0 0 1 3 12Z',
  cat: 'M5 4 8 8h8l3-4v10a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6V4Z',
  panda:
    'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16ZM6 3a2.5 2.5 0 0 1 2.5 2.5A2.5 2.5 0 0 1 6 8a2.5 2.5 0 0 1 0-5Zm12 0a2.5 2.5 0 0 1 0 5 2.5 2.5 0 0 1-2.5-2.5A2.5 2.5 0 0 1 18 3Z',
  bear: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM6 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm12 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z',
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
  const path = GLYPHS[avatarKey] ?? GLYPHS.fox!;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        sizeClass,
        COLOR_CLASSES[colorKey] ?? COLOR_CLASSES.sage,
      )}
    >
      {/* Le nom est deja affiche a cote : le pictogramme est purement decoratif. */}
      <svg viewBox="0 0 24 24" className="size-2/3" fill="currentColor" aria-hidden="true">
        <path d={path} />
      </svg>
      <span className="sr-only">{name}</span>
    </span>
  );
};

export { COLOR_CLASSES as AVATAR_COLOR_CLASSES };
