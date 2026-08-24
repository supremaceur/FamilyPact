# Déploiement

---

## Prérequis

| Composant  | Version                   | Note                                         |
| ---------- | ------------------------- | -------------------------------------------- |
| Node.js    | 22.12+ (ou 20.19+ / 24+)  | Contraint par Prisma 7                       |
| PostgreSQL | 14+                       | 16 recommandé                                |
| HTTPS      | Obligatoire en production | Le cookie `__Host-` l'exige ; WebAuthn aussi |

---

## Variables d'environnement

Toutes sont validées au démarrage par Zod. **Une configuration incomplète fait échouer
l'application immédiatement**, avec un message précis, plutôt que de produire un
comportement dégradé silencieux.

### Obligatoires

| Variable              | Format                          | Rôle                                                                              |
| --------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`        | URL PostgreSQL                  | Connexion applicative                                                             |
| `TOTP_ENCRYPTION_KEY` | 32 octets en base64             | Chiffre les secrets TOTP au repos                                                 |
| `LOG_PEPPER_KEY`      | 32 octets en base64             | Pseudonymise IP et agents utilisateurs                                            |
| `APP_ORIGIN`          | URL absolue                     | Origine exacte servie. WebAuthn et la vérification CSRF refusent toute divergence |
| `WEBAUTHN_RP_ID`      | Domaine **sans schéma ni port** | Relying Party ID                                                                  |
| `JOB_RUNNER_TOKEN`    | ≥ 24 caractères                 | Protège `/api/jobs/run`                                                           |

### Facultatives

| Variable                  | Défaut         | Rôle                                                             |
| ------------------------- | -------------- | ---------------------------------------------------------------- |
| `SHADOW_DATABASE_URL`     | —              | Base jetable pour `prisma migrate dev`                           |
| `TEST_DATABASE_URL`       | —              | Requise pour les tests d'intégration                             |
| `WEBAUTHN_RP_NAME`        | `FamiliPact`   | Nom affiché par le navigateur                                    |
| `DEFAULT_FAMILY_TIMEZONE` | `Europe/Paris` | Fuseau proposé à la création                                     |
| `NODE_ENV`                | `development`  | `production` active HSTS et le cookie `__Host-`                  |
| `ALLOW_DEV_SEED`          | —              | `1` autorise le seed. **Refusé en production**                   |
| `CRON_SECRET`             | —              | **Vercel uniquement.** Doit valoir exactement `JOB_RUNNER_TOKEN` |

### Génération des secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # clés de chiffrement
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" # jeton de jobs
```

### Pièges de configuration

**`APP_ORIGIN` et `WEBAUTHN_RP_ID` doivent concorder.** `WEBAUTHN_RP_ID` est le
domaine seul :

```bash
APP_ORIGIN="https://familipact.example.com"
WEBAUTHN_RP_ID="familipact.example.com"     # ✅ sans https://, sans port
```

Une divergence fait échouer toutes les clés d'accès, sans message explicite du
navigateur.

**Changer `WEBAUTHN_RP_ID` invalide les clés existantes.** Elles sont liées au domaine.
Un changement de domaine oblige les utilisateurs à réenregistrer leurs clés.

**Perdre `TOTP_ENCRYPTION_KEY` rend tous les TOTP inutilisables.** Elle doit être
sauvegardée avec le même soin que la base. La rotation n'est pas outillée en V1.

---

## Migrations

### Production

```bash
npx prisma migrate deploy
```

Applique les migrations en attente, sans jamais en générer ni réinitialiser la base.
C'est la **seule** commande à utiliser en production.

### Développement

```bash
npm run db:migrate                    # crée et applique une migration
npm run db:migrate -- --create-only   # crée sans appliquer, pour éditer le SQL
```

### État des migrations

| Migration                       | Contenu                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `20260824115907_initial_schema` | 22 tables, index et clés étrangères, dont les clés composites d'isolation                        |
| `20260824120500_domain_guards`  | Index uniques partiels, contraintes `CHECK`, triggers append-only, index partiels de performance |

La seconde est **écrite à la main** : Prisma ne sait exprimer ni les index partiels, ni
les `CHECK`, ni les triggers. Elle fait partie de l'historique et est rejouée sur la
base fantôme comme sur une base neuve — il n'y a donc pas de dérive.

La CI applique les migrations sur une base vierge à chaque exécution : leur bon
déroulement est vérifié en continu.

### Ordre de déploiement

```
1. npm ci
2. npx prisma generate      # inclus dans npm run build
3. npx prisma migrate deploy
4. npm run build
5. npm run start
```

Les migrations doivent précéder le démarrage : le code attend le schéma à jour.

---

## Jobs planifiés

Quatre jobs, **idempotents par créneau horaire**. Une double exécution sur la même
heure est sans effet.

| Job                    | Rôle                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| `generate-occurrences` | Matérialise les occurrences à venir, dans le fuseau de chaque famille |
| `detect-missed`        | Marque les échéances dépassées — **n'écrit jamais au ledger**         |
| `evaluate-rules`       | Réévalue paliers et conditions de levée à base de date                |
| `purge-expired`        | Nettoie sessions, défis et compteurs expirés                          |

### Fréquence des exécutions

**Le pas naturel est l'heure**, parce que c'est la granularité de la clé d'idempotence
(`hourlyRunKey` découpe le temps par heure entamée). Plus fréquent serait donc sans effet :
le second appel de la même heure est refusé par la contrainte unique `(jobName, runKey)`
et se termine sans rien faire.

**Moins fréquent est sûr, mais plus lent.** Aucun job ne raisonne sur une fenêtre
glissante, donc espacer les exécutions ne perd jamais rien :

| Job                    | Pourquoi un pas plus large ne perd rien                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `generate-occurrences` | Matérialise à 30 jours (`OCCURRENCE_HORIZON_DAYS`) — très au-delà d'un pas quotidien |
| `detect-missed`        | Filtre sur `dueAt < now`, **sans borne inférieure** : tout retard est rattrapé       |
| `evaluate-rules`       | Réévalue tous les enfants à chaque passage, sans mémoire du passage précédent        |
| `purge-expired`        | Supprime sur `expiresAt < now` — la donnée expirée reste refusée entre-temps         |

Ce qui change avec un pas quotidien est donc uniquement la **latence de détection** :
une échéance dépassée à 8 h n'apparaît dans « Actions requises » qu'à l'exécution
suivante. Rien n'est jamais retiré automatiquement, quel qu'en soit le délai.

### Déclenchement HTTP

```bash
curl -X POST https://familipact.example.com/api/jobs/run \
     -H "x-familipact-job-token: $JOB_RUNNER_TOKEN"
```

Le jeton est comparé **à temps constant**. Sans jeton valide : `403`.

La route accepte `GET` **et** `POST`, et reconnaît le jeton sous deux formes :
`x-familipact-job-token: <jeton>` ou `Authorization: Bearer <jeton>`. Un `GET` qui
écrit heurte les conventions HTTP ; deux propriétés le rendent sûr ici : la route est
inaccessible sans le jeton, et l'exécution est idempotente par créneau horaire — un
rejeu ne produit aucun effet supplémentaire.

C'est aussi la seule route de mutation sans vérification d'origine, et c'est
délibéré : un ordonnanceur n'est pas un navigateur, il n'envoie ni cookie ni en-tête
`Origin`. Exiger l'un ou l'autre casserait la route sans rien protéger.

Adapté aux plateformes serverless (Vercel Cron, Cloud Scheduler, GitHub Actions).

#### Vercel Cron

`vercel.json` est déjà versionné :

```json
{ "crons": [{ "path": "/api/jobs/run", "schedule": "0 19 * * *" }] }
```

**Pourquoi quotidien et non horaire.** Le plan _Hobby_ de Vercel n'autorise qu'une
exécution par jour ; une expression plus fréquente ne dégrade pas le service, elle fait
**échouer le déploiement entier** :

```
Hobby accounts are limited to daily cron jobs.
This cron expression (0 * * * *) would run more than once per day.
```

`0 19 * * *` est en **UTC** — Vercel n'interprète jamais autre chose. Cela place
l'exécution à 21 h à Paris l'été, 20 h l'hiver : en fin de journée, après la plupart des
échéances, avant que les parents ne referment l'application.

Pour revenir à un pas horaire, deux voies :

1. **Plan Pro** — remettre `"0 * * * *"` dans `vercel.json`, rien d'autre à changer.
2. **Ordonnanceur externe** — laisser Vercel de côté et appeler la route depuis un cron
   système, un conteneur, une planification GitHub Actions ou un service tiers. La route
   est publique et protégée par jeton : n'importe quel ordonnanceur capable d'émettre un
   `GET` avec un en-tête suffit.

Vercel Cron n'émet que des `GET` et ne sait pas ajouter d'en-tête personnalisé : il
joint `Authorization: Bearer $CRON_SECRET`. Il faut donc définir **deux** variables
d'environnement portant la **même valeur** :

| Variable           | Lue par                                  |
| ------------------ | ---------------------------------------- |
| `JOB_RUNNER_TOKEN` | L'application, pour valider l'appel      |
| `CRON_SECRET`      | Vercel, pour construire l'en-tête envoyé |

Si elles divergent, le cron s'exécute mais reçoit `403` : les échéances dépassées ne
sont plus détectées, et **rien ne le signale dans l'interface**. Après le premier
déploiement, vérifier une exécution dans l'onglet _Cron Jobs_ du projet.

### Déclenchement par processus

```bash
npm run jobs:run
```

Adapté à un cron système ou à un conteneur dédié.

```cron
0 * * * * cd /opt/familipact && npm run jobs:run >> /var/log/familipact-jobs.log 2>&1
```

### Que se passe-t-il si les jobs ne tournent pas ?

Le produit reste **cohérent**, mais dégradé :

- les occurrences au-delà de 30 jours ne sont plus générées ;
- les échéances dépassées ne remontent pas au tableau de bord ;
- les conditions de levée **à base de date** ne deviennent pas éligibles.

En revanche, les conditions à base de **score** restent évaluées : elles le sont à
chaque variation de score, dans la même transaction. Aucune donnée n'est perdue ; le
rattrapage se fait à la reprise des jobs.

---

## Build de production

```bash
npm run build   # prisma generate + next build
npm run start
```

Une `DATABASE_URL` doit être présente au build : le client Prisma la lit à sa
génération. Une URL syntaxiquement valide suffit — la base n'est pas contactée.

---

## Plateformes

### Serverless (Vercel, Netlify)

Fonctionne tel quel. Points d'attention :

- **Pool de connexions** — chaque instance ouvre son propre pool `pg`. Sur une base
  gérée à faible limite de connexions, prévoir un pooler (PgBouncer, Prisma Accelerate,
  Neon pooling).
- **Cron** — utiliser le planificateur de la plateforme, comme ci-dessus.

### Conteneur

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
EXPOSE 3000
CMD ["npm", "run", "start"]
```

Appliquer `npx prisma migrate deploy` **avant** de démarrer le conteneur applicatif.

### Derrière un proxy inverse

Faire suivre `X-Forwarded-For` et `X-Forwarded-Proto`. La première alimente le rate
limiting — pseudonymisée, jamais utilisée pour autoriser.

---

---

## Supabase comme hebergeur PostgreSQL

FamiliPact utilise Supabase **uniquement comme base PostgreSQL**. Il n'utilise
ni l'API REST (PostgREST), ni Supabase Auth, ni le client `@supabase/supabase-js`.

**Pourquoi pas Supabase Auth ?** La politique d'authentification de FamiliPact
(voir [authentication.md](authentication.md)) impose une MFA _bloquante_ modelisee
comme un etat de session, des comptes enfants **sans adresse e-mail**, et une
reauthentification par operation. Ce sont precisement les points qu'un service
d'authentification generique ne modelise pas nativement — c'est le raisonnement
de l'ADR-002 dans [architecture.md](architecture.md).

### Fermeture de la surface REST — obligatoire

Supabase expose par defaut toutes les tables du schema `public` via PostgREST,
avec la cle `anon`, **publique par conception**. La cle `service_role`, elle,
**contourne RLS**.

Sans intervention, n'importe qui disposant de ces cles pourrait lire les
empreintes de mots de passe, les secrets TOTP chiffres et les jetons de session.

La migration `familipact_07_fermeture_api_rest` ferme cette surface par deux
barrieres independantes :

| Barriere                                        | Effet                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| RLS active sur les 22 tables, **zero policy**   | `anon` et `authenticated` ne voient aucune ligne                         |
| `REVOKE ALL` sur tables, sequences et fonctions | `anon`, `authenticated` **et `service_role`** n'ont plus aucun privilege |
| `ALTER DEFAULT PRIVILEGES ... REVOKE`           | Les tables des futures migrations naissent closes                        |

L'application n'est pas affectee : elle se connecte avec le role **proprietaire**
des tables, qui contourne RLS et conserve tous ses privileges.

Verification apres tout changement de schema :

```sql
-- Doit rendre 0.
SELECT count(*) FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','service_role');

-- Doit rendre autant de lignes que de tables.
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;
```

### Chaines de connexion

Supabase propose deux ports, et **les deux sont necessaires** :

| Usage       | Port                             | Pourquoi                                                                              |
| ----------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| Application | **6543** (pooler transactionnel) | Le serverless ouvre beaucoup de connexions courtes ; le pooler les mutualise          |
| Migrations  | **5432** (connexion directe)     | Le pooler transactionnel ne supporte pas le DDL ni les instructions preparees longues |

```bash
DATABASE_URL="postgresql://postgres.<ref>:<MOT_DE_PASSE>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_DATABASE_URL="postgresql://postgres.<ref>:<MOT_DE_PASSE>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Le `<MOT_DE_PASSE>` est celui de la base — **ni la cle `anon`, ni la cle
`service_role`**, qui ne servent qu'a l'API REST inutilisee ici.

`connection_limit=1` avec `pgbouncer=true` est la configuration recommandee en
serverless : chaque instance de fonction garde une seule connexion, et le pooler
absorbe la concurrence.

---

## Deploiement sur Vercel

```
1. Importer le depot dans Vercel
2. Settings > Environment Variables > Import .env
3. Deployer
4. Appliquer les migrations (connexion DIRECTE, port 5432) :
      DATABASE_URL="<connexion directe>" npx prisma migrate deploy
5. Configurer le cron des jobs
```

### Cron des jobs

`vercel.json` :

```json
{ "crons": [{ "path": "/api/jobs/run", "schedule": "0 19 * * *" }] }
```

Vercel Cron n'envoie pas d'en-tête personnalisé, mais la route reconnaît aussi
`Authorization: Bearer` : il suffit donc de définir `CRON_SECRET` avec la même valeur
que `JOB_RUNNER_TOKEN`. Aucun cron externe ni route intermédiaire n'est nécessaire.

Le pas est **quotidien** parce que le plan _Hobby_ refuse plus d'une exécution par jour
et fait échouer le déploiement au-delà. Voir [Fréquence des exécutions](#fréquence-des-exécutions)
pour ce que cela change (de la latence, jamais de perte) et comment revenir à l'horaire.

La route refuse tout appel sans jeton valide : c'est volontaire, un ordonnanceur non
authentifié ne doit pas pouvoir déclencher les jobs.

### Points d'attention

**`APP_ORIGIN` doit correspondre au domaine reellement servi.** Sur Vercel, les
deploiements de previsualisation ont un domaine different a chaque fois :
WebAuthn et la verification d'origine echoueront sur ces URL. Reservez les
cles d'acces au domaine de production, ou definissez `APP_ORIGIN` par
environnement.

**`WEBAUTHN_RP_ID` est le domaine seul**, sans `https://`, sans port, sans
slash final. Le changer invalide toutes les cles d'acces deja enregistrees.

---

## Sauvegarde et restauration

Une seule base à sauvegarder, mais **deux secrets** sont indispensables à la
restauration :

| Élément               | Conséquence de la perte                                                            |
| --------------------- | ---------------------------------------------------------------------------------- |
| Base PostgreSQL       | Perte de toutes les données                                                        |
| `TOTP_ENCRYPTION_KEY` | **Tous les TOTP deviennent inutilisables** — tous les parents doivent se réenrôler |
| `LOG_PEPPER_KEY`      | Les empreintes d'IP passées ne sont plus corrélables (impact faible)               |

Sauvegarder la base sans la clé TOTP produit une restauration où **aucun parent ne peut
se connecter**. Les deux doivent être conservés ensemble, dans un coffre distinct de la
base.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=familipact-$(date +%F).dump
pg_restore --dbname="$DATABASE_URL" --clean --if-exists familipact-2026-08-24.dump
```

---

## Observabilité

### Journalisation

Erreurs serveur en **JSON structuré** sur la sortie standard. La pile d'appels n'est
incluse qu'en développement.

```json
{ "level": "error", "scope": "api", "message": "…" }
```

**Aucun secret n'est journalisé** : ni mot de passe, ni secret TOTP, ni code de secours,
ni jeton d'invitation.

### Points de surveillance recommandés

| Signal              | Où                                          | Seuil d'alerte            |
| ------------------- | ------------------------------------------- | ------------------------- |
| Jobs en échec       | `JobRun.status = 'FAILED'`                  | Toute occurrence          |
| Jobs absents        | `JobRun` sans ligne récente                 | Aucun succès depuis 2 h   |
| Échecs de connexion | `AuditLog` action `PARENT_LOGIN_FAILED`     | Pic inhabituel            |
| Échecs MFA          | `AuditLog` action `MFA_VERIFICATION_FAILED` | Pic inhabituel            |
| Cohérence du ledger | `recomputeBalance()`                        | Tout écart cache / ledger |

### Ajouter un outil de supervision

Le domaine ne dépend d'aucun fournisseur. Un point d'intégration existe dans
`withErrorHandling` (`src/server/http/respond.ts`) : y brancher Sentry ou équivalent
n'impacte aucune règle métier.

---

## Environnements

| Environnement | `NODE_ENV`    | Base                                       | Seed       |
| ------------- | ------------- | ------------------------------------------ | ---------- |
| Local         | `development` | `familipact_dev`                           | Autorisé   |
| Test          | `test`        | `familipact_test` — recréée à chaque suite | Non        |
| CI            | `test`        | PostgreSQL éphémère                        | Non        |
| Production    | `production`  | Base gérée, sauvegardée                    | **Refusé** |

Le seed **refuse** de s'exécuter si `NODE_ENV=production`, et exige `ALLOW_DEV_SEED=1`.
Double garde-fou : il crée des comptes aux mots de passe connus.

---

## Liste de vérification avant mise en production

- [ ] `TOTP_ENCRYPTION_KEY` et `LOG_PEPPER_KEY` générées aléatoirement, jamais réutilisées
- [ ] `JOB_RUNNER_TOKEN` généré aléatoirement
- [ ] Sur Vercel : `CRON_SECRET` défini avec la même valeur que `JOB_RUNNER_TOKEN`
- [ ] `APP_ORIGIN` correspond exactement à l'URL servie, en HTTPS
- [ ] `WEBAUTHN_RP_ID` est le domaine seul, sans schéma ni port
- [ ] `NODE_ENV=production`
- [ ] `ALLOW_DEV_SEED` **absente**
- [ ] `npx prisma migrate deploy` exécuté
- [ ] Jobs planifiés (horaire si le plan le permet, quotidien sinon) et leur exécution supervisée
- [ ] Sauvegarde de la base **et** des clés de chiffrement, dans des coffres distincts
- [ ] Restauration testée au moins une fois
- [ ] HTTPS actif, HSTS vérifié
- [ ] `npm run verify` passe sur le commit déployé
