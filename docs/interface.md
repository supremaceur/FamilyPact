# Interface

> Ce que l'interface doit dire, avec quels moyens. Écrit à partir du code en
> place, pas de règles souhaitées.

## Le principe visuel

L'application encadre des décisions familiales. Elle doit avoir l'air d'un
**carnet posé sur la table**, pas d'un tableau de bord d'entreprise ni d'un jeu.
Deux dérives à éviter, également :

- la froideur administrative — d'où le sable chaud plutôt qu'un gris pur ;
- la ludification — pas de confettis, pas de couleurs saturées, pas de
  récompense visuelle à l'action.

## Palette

Cinq familles en OKLCH, définies dans `@theme` (`src/app/globals.css`). Chacune
porte un sens ; aucune n'est décorative.

| Famille      | Sens                              | Où                                               |
| ------------ | --------------------------------- | ------------------------------------------------ |
| `pact`       | Le pacte. Teal profond, calme     | Actions principales, marque, progression         |
| `sand`       | Fonds et surfaces. Sable chaud    | Toutes les surfaces, tout le texte               |
| `amber-soft` | Attention, décision attendue      | Bandeaux « actions requises », badges en attente |
| `clay`       | Retrait, suppression. Terre cuite | Retraits de points, actions destructrices        |
| `leaf`       | Validation, gain                  | Points crédités, confirmations                   |

**`clay` n'est pas rouge vif, et c'est délibéré.** Retirer des points à un
enfant n'est pas une erreur système : c'est une décision réfléchie. La couleur ne
doit pas dramatiser.

## Surfaces et thème

Ne jamais écrire une couleur de fond ou de texte en dur. Les jetons sémantiques
suivent automatiquement le thème clair ou sombre :

| Jeton                                                  | Rôle                               |
| ------------------------------------------------------ | ---------------------------------- |
| `--surface`                                            | Fond de page                       |
| `--surface-raised`                                     | Cartes, éléments au-dessus du fond |
| `--surface-sunken`                                     | Sections en retrait, bandeaux      |
| `--border-subtle` / `--border-strong`                  | Séparateurs, contours              |
| `--text-primary` / `--text-secondary` / `--text-muted` | Hiérarchie du texte                |

Le thème sombre suit `prefers-color-scheme` : il n'existe pas de bascule
manuelle. Les variantes `dark:` de Tailwind s'alignent donc dessus.

**Une exception assumée** : le fond d'un QR code reste blanc dans les deux
thèmes. Un lecteur attend des modules sombres sur fond clair ; l'inverser rendrait
le code indéchiffrable.

## Rayons, ombres, typographie

| Jeton              | Valeur     | Usage                                               |
| ------------------ | ---------- | --------------------------------------------------- |
| `--radius-card`    | `1rem`     | Cartes, conteneurs                                  |
| `--radius-control` | `0.625rem` | Boutons, champs                                     |
| `--shadow-soft`    | —          | Cartes au repos                                     |
| `--shadow-lifted`  | —          | Éléments détachés du fond                           |
| `--font-numeric`   | monospace  | **Tout chiffre qui compte** : scores, deltas, codes |

`--font-numeric` n'est pas une coquetterie : un score qui change ne doit pas
faire sauter la mise en page, et un code à six chiffres se relit mieux à
chasse fixe.

## Largeur : une seule source

Vingt-deux pages codaient chacune sa largeur en dur. Sur un grand écran, le
contenu tenait dans un couloir de 390 px au milieu de 2000 — et corriger cela
demandait de retrouver vingt-deux valeurs. `PageBody` centralise le choix :

| Largeur         | Valeur          | Pour                                          |
| --------------- | --------------- | --------------------------------------------- |
| `lecture`       | `max-w-2xl`     | Formulaires, réglages, texte suivi            |
| `liste`         | `max-w-4xl`     | Listes et historiques                         |
| `tableauDeBord` | `max-w-[84rem]` | Les seules pages qui répartissent en colonnes |

**Élargir n'est pas la réponse partout.** Un formulaire étalé sur 1600 px se lit
plus mal, pas mieux : au-delà d'environ 75 caractères, l'œil perd la ligne
suivante. Seuls les tableaux de bord prennent toute la largeur, parce qu'ils
répartissent l'information au lieu de l'empiler.

`DashboardGrid` passe à deux colonnes à partir de `xl` : ce qui appelle une
décision à gauche, le contexte à droite. En dessous, une seule colonne — l'ordre
du DOM est donc aussi l'ordre de lecture au clavier et au lecteur d'écran.

## Le relief : direction « Ardoise »

Les surfaces sont posées sur le fond, pas découpées dedans. Trois moyens, tous
portés par des jetons :

| Jeton            | Effet                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `--app-backdrop` | Deux halos très faibles sur le fond de page, teintés vers le teal du pacte plutôt que vers un gris pur |
| `--card-surface` | Un dégradé très court sur les cartes, au lieu d'un aplat                                               |
| `--card-inset`   | Un filet clair d'un pixel en haut de chaque carte                                                      |

`<Card tone="lead">` ajoute un liseré teal et une ombre plus marquée. Il désigne
**la** carte qui attend une décision : sur un tableau de bord où tout se
ressemble, l'œil doit trouver sans lire.

Deux règles à tenir : **une seule carte `lead` par écran** — deux accents ne
désignent plus rien — et le liseré ne s'allume que s'il y a effectivement
quelque chose à décider. Un accent permanent cesse d'attirer l'œil au bout d'un
jour.

## Mobile d'abord

- **Tout doit tenir en 320 px de large.** C'est la contrainte réelle, pas 375.
- **Cibles tactiles de 44 px minimum** sur les actions principales
  (recommandation WCAG 2.5.5). `Button` porte `min-h-11` en taille `md` et
  `min-h-12` en `lg` ; `min-h-9` est réservé aux actions secondaires dans une
  carte déjà dense.
- Le zoom n'est **jamais** bridé : pas de `maximum-scale`.

### Le piège du SVG sans dimensions

Un `<svg>` qui ne porte qu'un `viewBox`, sans `width` ni `height`, vaut `auto` —
c'est-à-dire 100 % de son conteneur. Placé dans un conteneur en `w-fit`, le
calcul tourne en rond et se résout à **zéro**. C'est ce qui a réduit le QR code
à une pastille blanche. Un SVG inséré par `dangerouslySetInnerHTML` doit donc
toujours recevoir une largeur explicite depuis son conteneur.

## Composants

`src/components/ui/` porte les briques partagées. Avant d'écrire une variante
locale, vérifier qu'elle n'y est pas déjà :

`alert` · `avatar` · `badge` · `button` · `card` · `confirm-dialog` ·
`empty-state` · `field` · `progress` · `qr-code` · `skeleton`

Quand le même motif apparaît deux fois, le factoriser. Ce n'est pas une question
d'élégance : le QR code était cassé **à deux endroits** parce que le code avait
été dupliqué.

Les composants d'interface ne parlent jamais à la base. La règle est appliquée
par ESLint : `no-restricted-imports` interdit `@/server/**` dans
`src/components/**`. Les données arrivent en propriétés depuis un composant
serveur.

## Les textes

- **Sans accents dans le code source**, par cohérence avec l'existant. Les
  documents Markdown, eux, sont accentués.
- **Nommer la conséquence avant le clic.** Un bouton dit `Valider +20`, pas
  « Valider ». Une confirmation dit ce que l'enfant gagnera ou perdra, et
  affiche le score avant/après.
- **Ne jamais laisser croire à un automatisme.** Les écrans répètent que rien ne
  s'applique sans décision : « Aucun point n'a été retiré : c'est vous qui
  décidez. »
- Pas de ton infantilisant côté enfant. Un enfant lit « Mon score », pas
  « Bravo champion ».

## Ce que l'interface ne doit jamais montrer

Ces interdits viennent du produit, pas du goût :

- pas de badges, niveaux, séries, trophées ;
- pas de classement entre enfants, ni de comparaison entre frères et sœurs ;
- pas de catalogue où l'on dépense un solde — les points sont un repérage de
  progression, pas une monnaie ;
- aucun bouton qui applique une sanction ou une récompense sans confirmation
  explicite.

## Accessibilité

- Chaque page a un `<main id="contenu">` et un lien d'évitement.
- Les images porteuses de sens ont un `alt` qui décrit **ce qu'on y voit**, pas
  son nom de fichier. Les captures de la page d'accueil en sont l'exemple.
- Les états sont annoncés, pas seulement colorés : `aria-busy` sur un bouton en
  cours, `role="alert"` sur les erreurs.
- Un `role="img"` avec `aria-label` sur un conteneur de SVG masque le contenu
  décoratif aux lecteurs d'écran et donne une description utile.
- Le contraste des jetons `--text-*` sur `--surface-*` est tenu dans les deux
  thèmes. Toute nouvelle paire de couleurs doit être vérifiée.
