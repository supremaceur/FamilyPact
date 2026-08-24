# FamiliPact

**Les règles familiales, simplement.**

FamiliPact est une application web progressive (PWA) de gestion familiale : tâches,
points, récompenses et sanctions, avec **une décision parentale explicite à chaque étape**.

---

## Ce que FamiliPact fait — et ne fait pas

FamiliPact **n'est pas** un outil de contrôle parental technique. Il ne bloque aucun
téléphone, aucune application, aucun accès Internet ; il ne modifie aucun temps
d'écran ; il ne localise personne ; il n'impose techniquement aucune sanction.

Une sanction dans FamiliPact est une **information de gestion** : « pas de sortie ce
week-end », « console interdite deux jours ». L'application l'enregistre, la calcule
et la suit. Sa mise en œuvre reste entièrement de la responsabilité du parent.

Le principe fondateur du produit tient en quatre lignes :

> L'application calcule.
> L'application informe.
> L'application propose.
> **Le parent décide.**

Aucune sanction et aucune récompense n'est appliquée sans validation explicite d'un
parent autorisé. Le dépassement d'une échéance ne retire jamais de points tout seul :
il crée une demande de décision.

---

## Démarrage rapide

### Prérequis

- **Node.js 22.12+** (ou 20.19+ / 24+)
- **PostgreSQL 14+** (16 recommandé)

### Installation

```bash
# 1. Dépendances
npm ci

# 2. Configuration
cp .env.example .env
# Générez les deux clés obligatoires :
node -e "console.log('TOTP_ENCRYPTION_KEY=\"' + require('crypto').randomBytes(32).toString('base64') + '\"')"
node -e "console.log('LOG_PEPPER_KEY=\"' + require('crypto').randomBytes(32).toString('base64') + '\"')"
node -e "console.log('JOB_RUNNER_TOKEN=\"' + require('crypto').randomBytes(32).toString('base64url') + '\"')"
# Renseignez-les dans .env, ainsi que DATABASE_URL.

# 3. Base de données
npm run db:migrate       # applique les migrations
npm run db:seed          # famille de démonstration (développement uniquement)

# 4. Lancement
npm run dev              # http://localhost:3000
```

### Comptes de démonstration

Le seed affiche à la console les identifiants et les **secrets TOTP** à saisir dans
votre application d'authentification (Google Authenticator, Microsoft Authenticator,
Duo Mobile…). Ce sont des **données de démonstration** : elles n'ont aucune valeur et
le seed refuse de s'exécuter en production.

| Compte | Identifiant                  | Rôle                                    |
| ------ | ---------------------------- | --------------------------------------- |
| Marie  | `marie@demo.familipact.test` | Propriétaire                            |
| Paul   | `paul@demo.familipact.test`  | Parent (permissions par défaut)         |
| Lucas  | `lucas.demo`                 | Enfant — 375 points                     |
| Emma   | `emma.demo`                  | Enfant — 65 points, une sanction active |

---

## Commandes

### Développement

| Commande        | Effet                                                   |
| --------------- | ------------------------------------------------------- |
| `npm run dev`   | Serveur de développement sur le port 3000               |
| `npm run build` | Génère le client Prisma puis compile pour la production |
| `npm run start` | Sert le build de production                             |

### Qualité

| Commande               | Effet                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `npm run verify`       | Format + lint + types + tous les tests (à lancer avant de pousser) |
| `npm run typecheck`    | Vérification TypeScript stricte                                    |
| `npm run lint`         | ESLint (règles typées)                                             |
| `npm run lint:fix`     | ESLint avec corrections automatiques                               |
| `npm run format`       | Prettier                                                           |
| `npm run format:check` | Vérifie le formatage sans modifier                                 |

### Tests

| Commande                   | Effet                                               |
| -------------------------- | --------------------------------------------------- |
| `npm run test`             | Tests unitaires du domaine (aucune base requise)    |
| `npm run test:unit`        | Idem                                                |
| `npm run test:integration` | Tests d'intégration — **exige `TEST_DATABASE_URL`** |
| `npm run test:all`         | Unitaires + intégration                             |
| `npm run test:watch`       | Mode surveillance                                   |
| `npm run test:e2e`         | Tests de bout en bout (build de production requis)  |
| `npm run test:e2e:install` | Installe le navigateur pour Playwright              |

### Base de données

| Commande                    | Effet                                                  |
| --------------------------- | ------------------------------------------------------ |
| `npm run db:migrate`        | Crée et applique une migration (développement)         |
| `npm run db:migrate:deploy` | Applique les migrations existantes (production)        |
| `npm run db:generate`       | Régénère le client Prisma                              |
| `npm run db:seed`           | Famille de démonstration                               |
| `npm run db:studio`         | Explorateur de données Prisma                          |
| `npm run db:reset`          | **Destructif** — réinitialise la base de développement |

### Jobs planifiés

| Commande           | Effet                                                      |
| ------------------ | ---------------------------------------------------------- |
| `npm run jobs:run` | Exécute les jobs une fois (idempotent par créneau horaire) |

Les jobs sont également exposés en HTTP sur `/api/jobs/run`, en `GET` comme en `POST`,
avec `x-familipact-job-token` ou `Authorization: Bearer`. Sur Vercel, `CRON_SECRET` doit
valoir exactement `JOB_RUNNER_TOKEN`. Voir [docs/deployment.md](docs/deployment.md).

### Outils

| Commande                                                       | Effet                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `tsx --conditions=react-server scripts/capture-screenshots.ts` | Régénère les captures de la page d'accueil depuis le jeu de démonstration |
| `tsx --conditions=react-server scripts/check-rest-surface.ts`  | Vérifie (et répare) la fermeture de la surface REST côté Supabase         |

Les captures de `public/captures/` ne sont pas des maquettes : ce sont les pages réelles
de l'application, rendues avec les données de la famille de démonstration, en thème clair
et sombre. Le script exige un serveur de développement en cours d'exécution — la version
de production pose un cookie `__Host-` que le navigateur refuse en HTTP.

---

## Architecture en un coup d'œil

```
src/
├── domain/      Logique métier PURE — aucune entrée/sortie, testable sans base
│                Machine d'état des tâches, moteur de règles, matrice RBAC, fuseaux
├── server/      Couche serveur
│   ├── auth/    Sessions, TOTP, WebAuthn, codes de secours, rate limiting
│   ├── crypto/  Argon2id, AES-256-GCM, jetons, pseudonymisation
│   ├── db/      Client Prisma
│   ├── services/ Cas d'usage : autorisation + transaction + audit
│   ├── queries/ Lectures des tableaux de bord
│   ├── jobs/    Jobs planifiés idempotents
│   └── http/    Traduction des erreurs, protection CSRF
├── app/         Routes Next.js (App Router) — pages et API
├── components/  Interface réutilisable — ne touche jamais la base
└── lib/         Utilitaires partagés (env, formatage, client HTTP)
```

**Trois frontières sont vérifiées par le linter**, pas seulement par convention :

- `src/domain/**` ne peut importer ni ORM, ni framework, ni React ;
- `src/components/**` ne peut atteindre ni la base ni la couche serveur ;
- le client Prisma n'est instancié qu'à un seul endroit.

---

## Documentation

| Document                                         | Contenu                                                  |
| ------------------------------------------------ | -------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)     | Choix techniques, décisions et leurs justifications      |
| [docs/data-model.md](docs/data-model.md)         | Schéma relationnel, contraintes, invariants              |
| [docs/business-rules.md](docs/business-rules.md) | Règles métier, machines d'état, moteur de règles         |
| [docs/authentication.md](docs/authentication.md) | Politique MFA, TOTP, passkeys, sessions                  |
| [docs/permissions.md](docs/permissions.md)       | Matrice RBAC complète                                    |
| [docs/security.md](docs/security.md)             | Modèle de menace et défenses                             |
| [docs/privacy.md](docs/privacy.md)               | Données collectées, minimisation, RGPD                   |
| [docs/deployment.md](docs/deployment.md)         | Variables d'environnement, migrations, jobs, déploiement |

---

## Licence

Projet privé. Tous droits réservés.
