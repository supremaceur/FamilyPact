import { cn } from '@/lib/cn';

/**
 * Capture de l'application, presentee dans un chassis de telephone.
 *
 * Les captures sont produites par `scripts/capture-screenshots.ts` a partir du
 * jeu de demonstration (« Famille Durand »). Ce sont de vraies pages rendues
 * par l'application, pas des maquettes : ce que le visiteur voit ici est
 * exactement ce qu'il obtiendra.
 *
 * DEUX FICHIERS, UN SEUL TELECHARGEMENT — chaque ecran existe en version claire
 * et sombre. Le `<source media>` laisse le navigateur choisir avant la requete
 * reseau : la variante non retenue n'est jamais telechargee. Un simple
 * `dark:hidden` aurait charge les deux.
 *
 * CADRAGE — les captures font 412 x N px (N variable selon l'ecran). Elles sont
 * recadrees en CSS au format d'un telephone reel via `object-top` : le haut de
 * chaque page, qui porte l'information, reste visible.
 *
 * POURQUOI PAS `next/image` — l'optimiseur ne sait pas faire d'art direction, il
 * faut un `<picture>` pour choisir la variante de theme. Les fichiers sont deja
 * en WebP et a la taille exacte d'affichage : il n'y aurait aucun octet a gagner.
 */
export const AppPreview = ({
  capture,
  alt,
  eager = false,
  className,
}: {
  /** Nom de base du fichier, sans le suffixe de theme ni l'extension. */
  readonly capture: string;
  readonly alt: string;
  /** `true` pour l'unique capture visible au chargement (LCP). */
  readonly eager?: boolean;
  readonly className?: string;
}) => (
  <div
    className={cn(
      'rounded-[2.25rem] border border-[var(--border-strong)] bg-[var(--surface-raised)]',
      'p-2 shadow-[var(--shadow-lifted)]',
      className,
    )}
  >
    <div className="relative overflow-hidden rounded-[1.75rem] border border-[var(--border-subtle)] bg-[var(--surface)]">
      <picture>
        <source
          media="(prefers-color-scheme: dark)"
          srcSet={`/captures/${capture}-dark.webp`}
          type="image/webp"
        />
        <img
          src={`/captures/${capture}-light.webp`}
          alt={alt}
          width={412}
          height={860}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className="block aspect-[412/860] w-full object-cover object-top"
        />
      </picture>
    </div>
  </div>
);
