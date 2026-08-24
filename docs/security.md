# Sécurité

---

## Ce que l'application protège

FamiliPact manipule des données concernant des **mineurs** : scores, tâches, sanctions,
décisions parentales. Les enjeux réels, par ordre d'importance :

1. **Intégrité du ledger** — un score faux détruit la confiance dans le produit.
2. **Isolation entre familles** — une fuite entre familles serait un incident majeur.
3. **Séparation parent/enfant** — un enfant ne doit jamais pouvoir s'attribuer de points.
4. **Sécurité des comptes parents** — un compte compromis contrôle toute la famille.
5. **Minimisation des données** — voir [privacy.md](privacy.md).

---

## Défenses par surface

### Mots de passe

| Aspect            | Mise en œuvre                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hachage           | **Argon2id**, 19 MiB / 2 itérations / 1 voie (configuration de référence OWASP)                                                                                                     |
| Longueur minimale | 12 caractères (adulte), 8 (enfant)                                                                                                                                                  |
| Composition       | **Aucune règle arbitraire** — les recommandations actuelles (NIST SP 800-63B) privilégient la longueur ; les règles de composition produisent surtout des mots de passe prévisibles |
| Liste noire       | Les mots de passe les plus courants sont refusés quelle que soit leur longueur                                                                                                      |
| Stockage          | Vérifié par test : le hash commence par `$argon2id$` et ne contient jamais le mot de passe                                                                                          |

### Second facteur

Voir [authentication.md](authentication.md). En résumé : TOTP obligatoire et bloquant
pour les comptes parents, secret chiffré en AES-256-GCM lié à l'utilisateur, anti-rejeu
par pas de temps, codes de secours hachés en Argon2id.

### Sessions

Jetons opaques de 256 bits, seul le SHA-256 est stocké, cookie `__Host-` avec
`HttpOnly` / `Secure` / `SameSite=Lax`, double expiration, rotation après MFA,
révocation immédiate.

### Contre l'énumération de comptes

Trois mesures :

1. **Temps de réponse constant** — un identifiant inconnu déclenche une vérification
   Argon2id sur un hash factice ;
2. **Message identique** — code et message d'erreur strictement identiques pour un
   compte inexistant et un mot de passe faux ;
3. **404 indifférencié** — une ressource inexistante et une ressource appartenant à une
   autre famille renvoient exactement la même réponse.

Vérifié par test : le code et le message des deux erreurs sont comparés.

### Contre la force brute

Deux barrières successives, indépendantes :

| Barrière                    | Portée                                   | Seuil              |
| --------------------------- | ---------------------------------------- | ------------------ |
| Rate limit par identifiant  | Une cible précise                        | 8 / 15 min         |
| Rate limit par IP           | Attaque distribuée sur plusieurs comptes | 40 / 15 min        |
| Rate limit TOTP             | Devinette de code                        | 10 / 15 min        |
| Rate limit codes de secours | Devinette de code                        | 5 / heure          |
| Rate limit invitations      | Devinette de jeton                       | 15 / heure         |
| Rate limit inscriptions     | Création massive de comptes              | 5 / heure          |
| Verrouillage de compte      | Après échecs répétés                     | 10 échecs → 15 min |

Le verrouillage est volontairement **court** : il ralentit une attaque sans offrir à un
tiers un moyen simple de bloquer durablement un compte légitime.

Les compteurs sont stockés en base, avec un incrément atomique : ils restent corrects
avec plusieurs instances applicatives, ce qu'un compteur en mémoire ne serait pas.

### CSRF

Deux couches :

1. `SameSite=Lax` sur le cookie bloque déjà l'envoi automatique sur une requête POST
   inter-site ;
2. `assertSameOrigin()` vérifie l'origine côté serveur sur **toute** mutation, car
   `SameSite` seul dépend du navigateur et laisse passer certains cas limites.

La vérification lit `Origin`, retombe sur `Referer`, puis sur `Sec-Fetch-Site`. Vérifié
par un test E2E qui envoie une origine étrangère et attend un 403.

### XSS

| Défense                  | Mise en œuvre                                                     |
| ------------------------ | ----------------------------------------------------------------- |
| Échappement              | React échappe tout par défaut                                     |
| CSP à nonce              | Générée **par requête** dans le middleware, avec `strict-dynamic` |
| `object-src 'none'`      | Bloque les plugins                                                |
| `base-uri 'self'`        | Empêche le détournement des URL relatives                         |
| `frame-ancestors 'none'` | Anti-clickjacking                                                 |

**Deux usages de `dangerouslySetInnerHTML`**, tous deux volontaires et sûrs : les QR
codes SVG. Ils sont générés à partir d'une URI construite côté serveur (enrôlement TOTP)
ou d'un lien d'invitation construit localement — jamais à partir d'une saisie
utilisateur.

Avec `strict-dynamic`, une balise `<script>` injectée dans le HTML reste inerte : seuls
les scripts portant le nonce de la réponse, et ceux qu'ils chargent, s'exécutent.

### Injection SQL

Prisma paramètre toutes les requêtes. Deux `$queryRaw` existent, tous deux avec
interpolation balisée — donc paramétrée :

```ts
await tx.$queryRaw`SELECT … WHERE p."membershipId" = ${childMembershipId} FOR UPDATE`;
```

Les deux `$executeRawUnsafe` ne contiennent **aucune** interpolation : ce sont des
constantes littérales (`SET LOCAL familipact.purge = 'on'`).

### En-têtes de sécurité

Appliqués par `next.config.ts` (statiques) et le middleware (CSP à nonce) :

| En-tête                         | Valeur                                                      |
| ------------------------------- | ----------------------------------------------------------- |
| `Content-Security-Policy`       | Nonce par requête, `strict-dynamic`                         |
| `Strict-Transport-Security`     | `max-age=63072000; includeSubDomains; preload` (production) |
| `X-Content-Type-Options`        | `nosniff`                                                   |
| `X-Frame-Options`               | `DENY`                                                      |
| `Referrer-Policy`               | `strict-origin-when-cross-origin`                           |
| `Permissions-Policy`            | `camera=(), microphone=(), geolocation=(), …`               |
| `Cross-Origin-Opener-Policy`    | `same-origin`                                               |
| `Cache-Control` (sur `/api/**`) | `no-store, no-cache, must-revalidate, private`              |
| `X-Powered-By`                  | **Supprimé**                                                |

`geolocation=()` est explicite : le navigateur refusera la géolocalisation même si du
code la demandait. C'est une garantie technique adossée à une promesse produit.

Vérifiés par test E2E.

### Autorisation

Voir [permissions.md](permissions.md). Point essentiel : l'autorisation vit dans la
couche **service**, jamais dans la route. Ajouter une route sans contrôle ne crée pas
de faille — le service refuse.

### Isolation multi-tenant

Trois barrières indépendantes :

1. **PostgreSQL** — clé étrangère composite `(childMembershipId, familyId)` : une
   écriture croisée est rejetée par la base ;
2. **Couche service** — le `familyId` vient toujours de l'adhésion, jamais du client ;
3. **Messages** — 404 indifférencié.

Dix scénarios d'accès croisé sont testés, dont une écriture directe en base contournant
la couche service.

---

## Secrets et configuration

### Ce qui n'est jamais stocké en clair

| Donnée             | Traitement                                      |
| ------------------ | ----------------------------------------------- |
| Mot de passe       | Argon2id                                        |
| Code de secours    | Argon2id                                        |
| Secret TOTP        | AES-256-GCM, clé hors base, lié à l'utilisateur |
| Jeton de session   | SHA-256                                         |
| Jeton d'invitation | SHA-256                                         |
| Adresse IP         | HMAC-SHA256 tronqué                             |
| Agent utilisateur  | HMAC-SHA256 tronqué                             |

**Pourquoi SHA-256 suffit pour les jetons.** Un jeton de session (256 bits) ou
d'invitation (120 bits) est aléatoire : il n'y a rien à deviner par force brute. Un
hachage lent serait par ailleurs inutilisable pour une recherche par index. Un mot de
passe, lui, est devinable : d'où Argon2id.

### Variables d'environnement

Validées au démarrage par Zod (`src/lib/env.ts`). Une configuration incomplète fait
échouer l'application **immédiatement**, avec un message précis, plutôt que de produire
un comportement dégradé silencieux.

`src/lib/env.ts` importe `server-only` : le build échoue si un composant client
l'atteint par erreur.

**Aucune clé n'est présente dans le dépôt.** `.env` est ignoré par git ;
`.env.example` ne contient que des espaces réservés.

**Rotation de `TOTP_ENCRYPTION_KEY`** — perdre cette clé rend tous les TOTP existants
inutilisables. Une rotation exigerait de déchiffrer avec l'ancienne et rechiffrer avec
la nouvelle. Ce n'est pas outillé en V1 : c'est documenté comme une limite connue.

---

## Journalisation et audit

### Trois flux séparés

| Flux         | Contenu                         | Table              |
| ------------ | ------------------------------- | ------------------ |
| Technique    | Erreurs serveur, JSON structuré | Sortie standard    |
| Audit métier | Qui a décidé quoi               | `AuditLog`         |
| Ledger       | Mouvements de points            | `PointTransaction` |

### Liste blanche des métadonnées

`sanitizeMetadata()` n'accepte que des clés explicitement autorisées. Une clé inconnue
est **ignorée**, pas rejetée : impossible de faire fuiter accidentellement un champ
sensible en transmettant un objet trop large.

Une liste noire complémentaire — `password`, `token`, `secret`, `recoveryCode`,
`invitationToken`, `otpauthUrl`, `publicKey` — rend l'intention explicite à la relecture.

Les valeurs sont limitées aux scalaires : pas d'objet imbriqué, donc pas de risque
d'embarquer une entité complète venue de la base.

**Vérifié par test** : le code d'invitation en clair n'apparaît ni dans le résumé, ni
dans les métadonnées de l'audit ; un mot de passe erroné n'apparaît pas dans l'audit
d'échec de connexion.

---

## PWA et service worker

**Aucune donnée familiale n'est mise en cache.** Les requêtes `/api/**` sont en réseau
seul et ne sont jamais stockées. Seuls les fichiers statiques immuables de Next et une
page hors-ligne neutre sont mis en cache.

Raison : ces données concernent des mineurs, sur un appareil souvent partagé, parfois
prêté, parfois perdu.

Aucune file d'attente de mutations hors ligne : une validation rejouée pourrait créditer
une tâche déjà validée par un autre parent, ou s'appliquer à un score obsolète.
L'intégrité du ledger passe avant le confort hors ligne.

Vérifié par test E2E, qui inspecte le source du service worker : ce test échouera si
quelqu'un ajoute un jour `/api` au cache.

---

## Limites connues

Énoncées explicitement plutôt que passées sous silence.

| Limite                                              | Portée                                                | Atténuation                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Pas de récupération sans code de secours ni passkey | Un parent peut se retrouver bloqué                    | Nombre de codes restants affiché en permanence ; passkey proposée                           |
| Rate limiting en base                               | Latence légèrement supérieure à Redis                 | Volume familial minuscule ; module isolé, remplaçable                                       |
| Rotation de `TOTP_ENCRYPTION_KEY` non outillée      | Rotation manuelle                                     | Documenté ; migration à écrire si le besoin apparaît                                        |
| Pas de détection d'appareil inhabituel              | Une session volée reste utilisable jusqu'à révocation | Liste des sessions actives visible ; révocation immédiate possible                          |
| Pas de Web Push                                     | Les parents doivent ouvrir l'application              | Aucune règle métier ne dépend d'une notification                                            |
| CSP avec `'unsafe-inline'` en repli                 | Requis par Next pour les navigateurs anciens          | `strict-dynamic` prévaut sur les navigateurs modernes, qui ignorent alors `'unsafe-inline'` |

---

## Vérifications automatisées

| Propriété                                            | Test                                |
| ---------------------------------------------------- | ----------------------------------- |
| Mot de passe haché en Argon2id                       | `authentication.test.ts`            |
| Message identique compte inconnu / mot de passe faux | `authentication.test.ts`            |
| Verrouillage après échecs répétés                    | `authentication.test.ts`            |
| Rotation du jeton après MFA                          | `authentication.test.ts`            |
| Expiration absolue non prolongée                     | `authentication.test.ts`            |
| Anti-rejeu TOTP                                      | `authentication.test.ts`            |
| Secret TOTP inutilisable sur un autre compte         | `authentication.test.ts`            |
| Rate limiting effectif                               | `authentication.test.ts`            |
| Jeton d'invitation non stocké en clair               | `isolation-and-invitations.test.ts` |
| Usage unique sous concurrence                        | `isolation-and-invitations.test.ts` |
| Jeton enfant ne crée pas un compte parent            | `isolation-and-invitations.test.ts` |
| Dix scénarios d'isolation entre familles             | `isolation-and-invitations.test.ts` |
| Ledger et audit immuables                            | `ledger-and-tasks.test.ts`          |
| En-têtes de sécurité                                 | `parcours-critiques.spec.ts`        |
| Refus d'origine étrangère                            | `parcours-critiques.spec.ts`        |
| Jeton exigé pour les jobs                            | `parcours-critiques.spec.ts`        |
| Service worker ne cache pas `/api`                   | `parcours-critiques.spec.ts`        |

---

## Signaler une vulnérabilité

Ce dépôt est privé. Signalez toute vulnérabilité directement au propriétaire du projet,
sans passer par un ticket public.
