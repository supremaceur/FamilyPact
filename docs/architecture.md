# Architecture

Ce document décrit **ce qui a été choisi et pourquoi**. Chaque décision qui aurait
pu raisonnablement être tranchée autrement est justifiée, avec l'alternative écartée.

---

## 1. Vue d'ensemble

FamiliPact est un **monolithe modulaire** : une seule application Next.js, un seul
schéma PostgreSQL, des frontières internes strictes.

Une famille compte quelques utilisateurs et produit un trafic minuscule. Découper ce
domaine en services séparés multiplierait les modes de panne, rendrait impossible la
cohérence transactionnelle entre le ledger de points et le moteur de règles, et
n'apporterait aucun bénéfice. Les frontières qui comptent — domaine, autorisation,
persistance, transport — sont posées **dans le code**, pas dans le réseau.

```
┌─────────────────────────────────────────────────────────────┐
│  src/app        Routes Next.js : pages (RSC) et API          │
│                 Traduisent HTTP ↔ services. Aucune logique.  │
├─────────────────────────────────────────────────────────────┤
│  src/server/services   Cas d'usage                           │
│                 Autorisation → transaction → audit           │
│                 SEULE couche autorisée à écrire              │
├─────────────────────────────────────────────────────────────┤
│  src/domain     Métier PUR — aucune E/S                      │
│                 Machine d'état, moteur de règles, RBAC       │
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL     Invariants structurels                       │
│                 Contraintes, index partiels, triggers        │
└─────────────────────────────────────────────────────────────┘
```

### Le principe qui gouverne tout

> Le système **détecte** et **propose**. Le parent **décide**.

Cette séparation n'est pas une convention d'écriture : elle est structurelle.

- `src/domain/rules-engine.ts` produit des **intentions** (`RewardProposalIntent`,
  `SanctionProposalIntent`). Il n'existe aucune intention « accorder » ou « activer ».
- `src/domain/tasks.ts` expose `ledgerEffectOf()`, qui ne renvoie un delta que pour
  deux transitions — `APPROVE` et `CONFIRM_MISSED` — toutes deux déclenchées par un
  parent.
- Le job d'échéance appelle `detectMissedOccurrences()`, qui change un état et
  n'écrit jamais au ledger.

Écrire du code qui accorderait une récompense automatiquement demanderait d'ajouter
un type d'intention, une transition et un chemin d'écriture. Ce n'est pas un oubli
possible : c'est un changement visible en revue.

---

## 2. Choix de la pile technique

Chaque version a été vérifiée sur le registre npm au moment de la construction, puis
validée par un `npm audit` sans vulnérabilité.

| Domaine       | Choix                | Version         | Justification                                                                                                                                                     |
| ------------- | -------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js (App Router) | 16.3.2          | Rendu serveur, routes API et service worker dans un seul déploiement. Les composants serveur permettent d'appliquer l'autorisation **avant** le rendu, pas après. |
| Langage       | TypeScript           | **6.0.3**       | Voir ADR-001.                                                                                                                                                     |
| Base          | PostgreSQL           | 16              | Index uniques **partiels**, contraintes `CHECK`, triggers : les invariants métier tiennent au niveau de la base.                                                  |
| ORM           | Prisma               | 7.9.1           | Migrations versionnées et rejouables, types générés, transactions interactives.                                                                                   |
| Validation    | Zod                  | 4.4.3           | Un seul schéma sert de validation runtime **et** de type TypeScript.                                                                                              |
| Mots de passe | @node-rs/argon2      | 2.1.0           | Argon2id aux paramètres OWASP. Binaire précompilé : aucune chaîne de compilation en production.                                                                   |
| TOTP          | otpauth              | 9.5.1           | RFC 6238, zéro dépendance, activement maintenu.                                                                                                                   |
| WebAuthn      | @simplewebauthn      | 13.3.x          | Référence de fait, côté serveur et navigateur.                                                                                                                    |
| QR code       | uqr                  | 0.1.3           | Zéro dépendance, sortie SVG — compatible avec une CSP stricte, sans requête réseau.                                                                               |
| Style         | Tailwind CSS         | 4.3.3           | Voir ADR-005.                                                                                                                                                     |
| Tests         | Vitest + Playwright  | 4.1.11 / 1.62.1 | Unitaires rapides sans base ; E2E sur l'application réelle.                                                                                                       |

---

## ADR-001 — TypeScript 6, pas TypeScript 7

**Décision.** Le projet est figé sur TypeScript **6.0.3**, alors que 7.0.2 est la
version stable la plus récente.

**Raison.** `typescript-eslint@8.67` déclare `typescript: ">=4.8.4 <6.1.0"`. Avec
TypeScript 7, tout le linting typé — `no-floating-promises`,
`no-misused-promises`, `switch-exhaustiveness-check` — cesserait de fonctionner.

Ces règles ne sont pas cosmétiques dans ce projet précis : une promesse non attendue
dans un service qui écrit au ledger produirait une transaction fantôme, et un `switch`
non exhaustif sur un état de tâche laisserait passer une transition non gérée.

**Arbitrage.** Renoncer aux gains de compilation de TypeScript 7 coûte quelques
secondes de build. Renoncer au linting typé coûterait des bugs d'intégrité. Le choix
n'est pas serré.

**Réévaluation.** Dès que `typescript-eslint` publie une version acceptant TypeScript 7,
la mise à jour est un changement de deux lignes dans `package.json`.

---

## ADR-002 — Authentification construite sur mesure

**Décision.** L'authentification n'utilise pas de framework tout-en-un (Better Auth,
Auth.js). Elle assemble des primitives éprouvées : `@node-rs/argon2`, `otpauth`,
`@simplewebauthn`, et des sessions opaques en base.

**Raison.** Le cahier des charges impose une politique que ces frameworks ne modélisent
pas directement :

1. **MFA obligatoire et bloquante** — un compte parent sans TOTP confirmé ne doit
   accéder à _aucune_ donnée familiale. Ce n'est pas « proposer la MFA » : c'est un
   état de session à part entière (`PENDING_MFA_ENROLLMENT`).
2. **Comptes enfants sans email** — identifiant de connexion distinct du nom affiché,
   sans MFA obligatoire, sans adresse.
3. **Réauthentification par opération** — certaines actions exigent une vérification
   récente, avec une fenêtre courte.
4. **Passkey sans contournement** — enregistrer une clé d'accès ne doit jamais
   permettre de retirer le TOTP.

Chacun de ces points demanderait d'étendre ou de contourner un framework. La somme des
contournements aurait été plus longue, moins lisible et moins testable que
l'implémentation directe.

**Ce qui n'est PAS fait maison.** Aucune primitive cryptographique n'a été réécrite :
le hachage de mot de passe, le TOTP et WebAuthn viennent tous de bibliothèques
spécialisées. Ce qui est construit ici, c'est **la politique**, pas la cryptographie.

**Coût assumé.** ~900 lignes à maintenir, couvertes par 30 tests d'intégration
dédiés (rotation de session, rejeu TOTP, énumération de comptes, force brute).

Voir [authentication.md](authentication.md).

---

## ADR-003 — Sessions opaques en base, pas de JWT

**Décision.** Le cookie ne contient qu'un jeton aléatoire de 256 bits. Seul son
SHA-256 est stocké. Chaque requête relit la session.

**Alternative écartée.** Un JWT auto-porteur éviterait une requête par appel.

**Raison du rejet.** Un JWT reste valide jusqu'à son expiration. Or FamiliPact doit
pouvoir **couper l'accès immédiatement** : un parent retiré de la famille, une
réinitialisation de MFA, une déconnexion depuis un appareil perdu. Attendre l'expiration
serait une faille, pas un compromis.

Le coût réel est une requête indexée par navigation, sur une base qui contient quelques
milliers de lignes.

**Conséquences implémentées.** Double expiration (glissante 12 h, absolue 30 jours),
rotation du jeton après validation du second facteur — protection contre la fixation
de session — et révocation en masse par utilisateur.

---

## ADR-004 — Cache offline volontairement minimal

**Décision.** Le service worker ne met en cache que les ressources statiques
immuables de Next et une page hors-ligne neutre. **Aucune donnée familiale.** Les
requêtes `/api/**` sont en réseau seul et ne sont jamais stockées.

**Raison.** Ces données concernent des mineurs : scores, tâches, sanctions. Un appareil
familial est souvent partagé, parfois prêté, parfois perdu. Le rapport
bénéfice/risque d'un cache de score consulté hors ligne est mauvais.

**Ce qui est écarté aussi.** Aucune file d'attente de mutations hors ligne. Une
validation de tâche mise en file puis rejouée à la reconnexion pourrait :

- créditer une tâche qu'un autre parent a déjà validée entre-temps ;
- s'appliquer à un score qui a changé, invalidant l'aperçu « 180 → 200 » affiché ;
- déclencher un franchissement de seuil sur un score obsolète.

L'intégrité du ledger passe avant le confort hors ligne. C'est explicitement ce
qu'autorise le cahier des charges.

**Conséquence acceptée et documentée dans l'interface.** FamiliPact exige une
connexion pour agir. La page hors-ligne le dit clairement.

---

## ADR-005 — Tailwind avec jetons sémantiques, pas de bibliothèque de composants

**Décision.** Tailwind CSS v4, une palette OKLCH définie dans `@theme`, et une
douzaine de composants écrits à la main.

**Raison.** L'interface est volontairement restreinte : boutons, cartes, champs,
étiquettes, barres de progression, une boîte de dialogue. Importer une bibliothèque
complète pour cela ajouterait des dizaines de dépendances transitives pour un usage
marginal.

Les deux composants qui posent réellement des difficultés d'accessibilité sont traités
par le **navigateur** :

- la boîte de confirmation utilise `<dialog>` natif — piège de focus, touche Échap et
  fond inerte sont gérés nativement ;
- les champs utilisent des `<label>`, `<fieldset>` et `aria-describedby` standard.

**OKLCH** est choisi parce que sa luminosité est perceptuellement uniforme : les
contrastes AA sont atteints par construction, sans ajustement à l'œil.

---

## ADR-006 — Écritures via routes API, lectures via composants serveur

**Décision.** Les lectures passent par des composants serveur qui appellent
`src/server/queries`. Les écritures passent par des routes `/api/**` appelées depuis
des composants client.

**Alternative écartée.** Les Server Actions de Next auraient supprimé la couche de
routes.

**Raison du rejet.** Trois arguments concrets :

1. **Testabilité de l'isolation.** Le cahier des charges exige de vérifier qu'un
   utilisateur de la famille A ne peut pas atteindre une ressource de la famille B
   « en manipulant l'URL/API ». Une surface HTTP explicite se teste directement, avec
   de vrais identifiants manipulés.
2. **Vérification d'origine.** La protection CSRF s'applique uniformément à toutes les
   mutations, à un seul endroit (`assertSameOrigin`).
3. **Erreurs uniformes.** `withErrorHandling` traduit chaque erreur du domaine en
   statut HTTP, et garantit qu'aucune trace technique ne fuit vers le client.

**Invariant qui rend cela sûr.** L'autorisation vit dans la couche **service**, pas
dans la route. Une route est un adaptateur de quelques lignes. Ajouter une route sans
autorisation ne crée pas de faille : le service refuse.

---

## 3. Isolation multi-tenant

La famille est l'unité d'isolation. Trois barrières indépendantes la protègent.

### Barrière 1 — structurelle (PostgreSQL)

Chaque table métier porte `familyId` et référence l'enfant par une clé étrangère
**composite** :

```sql
FOREIGN KEY ("childMembershipId", "familyId")
  REFERENCES "FamilyMembership"("id", "familyId")
```

Une transaction de la famille B qui désignerait un enfant de la famille A est rejetée
par la base, quel que soit le code applicatif. C'est vérifié par test.

### Barrière 2 — couche service

Aucun service n'accepte de `familyId` venant du client. Il provient toujours de
`requireFamilyActor()`, qui le lit sur l'**adhésion** de l'utilisateur connecté.
Chaque requête est filtrée par cette valeur.

### Barrière 3 — messages indifférenciés

Une ressource inexistante et une ressource appartenant à une autre famille renvoient
le même 404, avec le même message. L'API n'est pas un oracle d'existence.

**Nuance documentée.** Les colonnes d'_acteur_ (`createdById`, `decidedById`,
`approvedById`…) utilisent une clé simple, non composite : une clé composite imposerait
`ON DELETE SET NULL` sur `familyId`, colonne `NOT NULL`. Le rattachement de l'acteur à
sa famille est donc garanti par la couche service et couvert par les tests d'isolation.

---

## 4. Concurrence et idempotence

Deux parents peuvent décider en même temps. Quatre mécanismes se cumulent.

| Mécanisme                                 | Où                   | Ce qu'il garantit                                         |
| ----------------------------------------- | -------------------- | --------------------------------------------------------- |
| `SELECT … FOR UPDATE` sur `ChildProfile`  | `services/ledger.ts` | Sérialise les écritures concernant un même enfant         |
| Unique `(sourceType, sourceId, type)`     | `PointTransaction`   | Une occurrence n'est créditée ou pénalisée qu'une fois    |
| `updateMany` conditionné à l'état attendu | services de décision | La seconde requête concurrente ne met à jour aucune ligne |
| Clé d'idempotence facultative             | ajustements manuels  | Un double envoi ne crée qu'une transaction                |

**Comportement en cas de course.** La seconde décision **ne lève pas d'erreur** : elle
renvoie `alreadyDecided: true`, et l'interface affiche « Cette décision a déjà été
prise par un autre parent ». Une erreur brutale serait techniquement correcte mais
mauvaise pour un parent qui n'a rien fait de mal.

Vérifié par des tests qui lancent réellement quatre validations en parallèle.

---

## 5. Le ledger comme source de vérité

Le score d'un enfant **est** la somme de ses transactions. Un solde en cache
(`ChildProfile.cachedBalance`) existe pour les performances, mais :

- il est mis à jour dans la **même transaction SQL** que l'écriture du ledger ;
- `recomputeBalance()` permet de le recalculer et de le corriger ;
- un test d'intégration compare systématiquement cache et ledger.

**Append-only, garanti par la base.** Un trigger PostgreSQL rejette tout `UPDATE` et
tout `DELETE` sur `PointTransaction` et `AuditLog`. Corriger une erreur consiste à
écrire la transaction inverse (`reversesTransactionId`) : l'erreur **et** sa correction
restent visibles, avec leur auteur, leur date et leur motif.

Seule exception, explicite : l'effacement RGPD pose le drapeau de session
`familipact.purge = 'on'` **dans** la transaction concernée, via `SET LOCAL`.

---

## 6. Temps et fuseaux horaires

Deux types distincts, jamais confondus :

- un **instant** (échéance, horodatage) est stocké en UTC ;
- une **date locale** (jour d'une occurrence) est stockée en texte `YYYY-MM-DD` et n'a
  de sens que rapportée au fuseau IANA de la famille.

La conversion s'appuie sur `Intl.DateTimeFormat`, disponible partout, plutôt que sur
une dépendance de manipulation de dates. Le besoin se limite à instant ↔ date locale.

Les heures ambiguës et inexistantes suivent la convention Temporal
`disambiguation: "compatible"` : la **première** occurrence pour une heure ambiguë
(retour à l'heure d'hiver), un décalage **vers l'avant** pour une heure inexistante
(passage à l'heure d'été). Couvert par des tests sur les deux bascules 2026.

La logique de récurrence ne dépend jamais du fuseau du serveur : `runGenerateOccurrences`
traite chaque famille dans **son** fuseau.

---

## 7. Extension future

Les points d'extension sont des **interfaces propres**, pas du code inactif.

| Extension                | Point d'accroche                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Internationalisation     | `src/i18n/fr.ts` + `getDictionary(locale)` ; `Family.locale` et `User.locale` existent en base                                                   |
| Nouveaux types de règles | `evaluate()` prend des vues (`RewardRuleView`, `SanctionRuleView`) et rend des intentions : ajouter un type n'oblige pas à toucher aux existants |
| Web Push                 | `Notification` porte déjà destinataire, type et clé de déduplication ; il ne manque que le transport                                             |
| Rate limiting distribué  | Isolé dans `server/auth/rate-limit.ts` — un seul module à remplacer                                                                              |
| Récurrences complexes    | `RecurrenceSpec` est une structure, pas un champ : une RRULE s'y ajoute sans casser `planOccurrences`                                            |

Conformément au cahier des charges, **aucune fonctionnalité interdite n'est amorcée** :
pas de contrôle d'appareil, pas de géolocalisation, pas de monnaie virtuelle, pas de
gamification. Rien n'est « préparé en coulisses ».
