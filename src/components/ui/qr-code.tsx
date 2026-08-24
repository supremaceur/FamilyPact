import { cn } from '@/lib/cn';

/**
 * QR code, rendu a partir d'un SVG deja genere.
 *
 * POURQUOI UNE LARGEUR EXPLICITE — `uqr` produit un `<svg>` qui porte un
 * `viewBox` mais NI `width` NI `height`. Ses dimensions valent donc `auto`,
 * c'est-a-dire 100 % du conteneur. Place dans un conteneur en `w-fit`, le
 * calcul tourne en rond : le parent attend la taille de l'enfant, l'enfant
 * celle du parent. Il se resout a zero, et il ne reste que la marge
 * interieure — un carre blanc de quelques pixels que l'arrondi transforme en
 * pastille. Le conteneur porte donc une largeur explicite, et le SVG la
 * remplit.
 *
 * FOND BLANC EN TOUTES CIRCONSTANCES — un QR code se lit par contraste, et les
 * lecteurs attendent des modules sombres sur fond clair. Le fond ne suit donc
 * pas le theme : l'inverser rendrait le code indechiffrable en mode sombre.
 */
export const QrCode = ({
  svg,
  label,
  className,
}: {
  /** SVG complet issu de `uqr` — jamais une donnee saisie par un utilisateur. */
  readonly svg: string;
  /** Description pour les lecteurs d'ecran : le SVG lui-meme n'apprend rien. */
  readonly label: string;
  readonly className?: string;
}) => (
  <div
    className={cn(
      'w-[13.5rem] max-w-full rounded-[var(--radius-card)] border border-[var(--border-subtle)]',
      'bg-white p-3',
      '[&>svg]:block [&>svg]:h-auto [&>svg]:w-full',
      className,
    )}
    dangerouslySetInnerHTML={{ __html: svg }}
    role="img"
    aria-label={label}
  />
);
