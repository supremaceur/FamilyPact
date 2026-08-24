import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Largeur des pages, decidee a UN seul endroit.
 *
 * Vingt-deux pages codaient chacune sa largeur en dur — `max-w-xl` ici,
 * `max-w-3xl` la. Sur un grand ecran, le contenu tenait dans un couloir de
 * 390 px au milieu de 2000, et corriger cela demandait de retrouver vingt-deux
 * valeurs. C'est la meme duplication qui avait casse le QR code a deux
 * endroits.
 *
 * ELARGIR N'EST PAS LA REPONSE PARTOUT. Un formulaire etale sur 1600 px se lit
 * plus mal, pas mieux : au-dela d'environ 75 caracteres, l'oeil perd la ligne
 * suivante. D'ou trois largeurs, choisies par ce que la page contient :
 *
 *   lecture   — formulaires, reglages, texte suivi. Reste etroit, deliberement.
 *   liste     — listes et historiques : des lignes courtes, qui supportent
 *               d'etre plus larges sans devenir illisibles.
 *   tableauDeBord — la seule qui prend toute la largeur, parce qu'elle repartit
 *               l'information en colonnes plutot que de l'empiler.
 */
export type LargeurPage = 'lecture' | 'liste' | 'tableauDeBord';

const LARGEURS: Readonly<Record<LargeurPage, string>> = {
  lecture: 'max-w-2xl',
  liste: 'max-w-4xl',
  tableauDeBord: 'max-w-[84rem]',
};

export const PageBody = ({
  largeur = 'liste',
  className,
  children,
}: {
  readonly largeur?: LargeurPage;
  readonly className?: string;
  readonly children: ReactNode;
}) => <div className={cn('mx-auto w-full', LARGEURS[largeur], className)}>{children}</div>;

/**
 * Grille d'un tableau de bord.
 *
 * Deux colonnes a partir de `xl` : ce qui appelle une decision a gauche, le
 * contexte a droite. En dessous, une seule colonne — l'ordre du DOM place donc
 * l'essentiel en premier, ce qui est aussi l'ordre de lecture au clavier et au
 * lecteur d'ecran.
 */
export const DashboardGrid = ({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) => (
  <div className={cn('grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]', className)}>
    {children}
  </div>
);

/** Colonne d'un tableau de bord : empile ses cartes avec un espacement constant. */
export const DashboardColumn = ({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) => <div className={cn('flex min-w-0 flex-col gap-5', className)}>{children}</div>;
