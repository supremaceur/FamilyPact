# Modèle de données

PostgreSQL 16, géré par Prisma. Le schéma vit dans `prisma/schema.prisma` ; les
garanties que Prisma ne sait pas exprimer — index uniques partiels, contraintes
`CHECK`, triggers — sont écrites à la main dans
`prisma/migrations/20260824120500_domain_guards/migration.sql`.

---

## Deux invariants structurels

Ces deux règles gouvernent tout le schéma. Elles tiennent **au niveau de la base**,
et pas seulement dans le code applicatif.

### 1. Isolation familiale

Chaque table métier porte `familyId` et référence l'enfant concerné par une clé
étrangère **composite** :

```
(childMembershipId, familyId) → FamilyMembership(id, familyId)
```

Une ligne dont l'enfant appartiendrait à une autre famille est rejetée par PostgreSQL.

### 2. Journaux immuables

`PointTransaction` et `AuditLog` n'acceptent que des `INSERT`. Un trigger rejette
`UPDATE` et `DELETE`. Une erreur se corrige par une écriture inverse, jamais par une
réécriture.

---

## Diagramme

```
                            ┌───────────────┐
                            │    Family     │
                            │  timeZone     │
                            └───────┬───────┘
                                    │ 1
                    ┌───────────────┼───────────────┬──────────────┐
                    │ n             │ n             │ n            │ n
          ┌─────────▼────────┐ ┌────▼──────┐ ┌──────▼──────┐ ┌─────▼──────┐
          │ FamilyMembership │ │Invitation │ │TaskDefinition│ │ AuditLog   │
          │ role, status     │ │tokenHash  │ │ recurrence   │ │ append-only│
          └───┬────────┬─────┘ │ targetRole│ │ version      │ └────────────┘
              │ 1      │ 1     └───────────┘ └──────┬───────┘
              │        │                            │ n
    ┌─────────▼───┐  ┌─▼──────────────────────┐ ┌───▼──────────────┐
    │ChildProfile │  │ ParentPermissionGrant  │ │ TaskOccurrence   │
    │cachedBalance│  │ permission             │ │ state, snapshots │
    └─────────────┘  └────────────────────────┘ └──────────────────┘
              │
              │ enfant concerné (FK composite avec familyId)
    ┌─────────┼─────────────┬────────────────┬─────────────────┐
    │         │             │                │                 │
┌───▼──────────────┐ ┌──────▼─────┐ ┌────────▼──────┐ ┌────────▼────────┐
│ PointTransaction │ │ RewardRule │ │ SanctionRule  │ │ Notification    │
│ append-only      │ │ threshold  │ │ threshold     │ │ dedupeKey       │
│ delta, type      │ └──────┬─────┘ │ armed         │ └─────────────────┘
│ reversesTx ──┐   │        │ 1     └───────┬───────┘
└──────────────┼───┘  ┌─────▼──────┐ ┌──────▼───────────┐
               │      │RewardEvent │ │ SanctionInstance │
               └─auto─┘│ status    │ │ status, liftAt   │
                       └────────────┘ └──────────────────┘

  Identité / authentification (hors périmètre famille)
  ┌──────┐ 1─1 ┌────────────────┐   1─n ┌──────────────┐
  │ User ├─────┤ TotpCredential │   ────┤ RecoveryCode │
  │ kind │     │ secret chiffré │       └──────────────┘
  └───┬──┘     └────────────────┘
      │ 1─n ┌─────────┐  ┌──────────────────────┐  ┌───────────────────┐
      └─────┤ Session │  │ WebAuthnCredential   │  │ WebAuthnChallenge │
            │ status  │  │ publicKey, counter   │  │ consumedAt        │
            └─────────┘  └──────────────────────┘  └───────────────────┘

  Infrastructure : JobRun (jobName, runKey unique) · RateLimitCounter
```

---

## Tables

### Identité et authentification

#### `User`

Un compte, adulte ou enfant. Le `kind` détermine le régime d'authentification.

| Colonne                           | Type               | Note                                                       |
| --------------------------------- | ------------------ | ---------------------------------------------------------- |
| `kind`                            | `ADULT` \| `CHILD` | Détermine la politique MFA                                 |
| `email`                           | `String?` unique   | Normalisé en minuscules. **Null pour les enfants**         |
| `loginId`                         | `String?` unique   | Identifiant de connexion enfant. **Null pour les adultes** |
| `displayName`                     | `String`           | Nom affiché — **distinct** de `loginId`                    |
| `passwordHash`                    | `String`           | Argon2id                                                   |
| `failedLoginCount`, `lockedUntil` |                    | Verrouillage temporaire après échecs répétés               |

`loginId` et `displayName` sont séparés : renommer un enfant dans l'interface ne casse
jamais ses identifiants de connexion.

#### `TotpCredential`

Un secret TOTP par utilisateur. **Chiffré au repos** en AES-256-GCM, avec l'identifiant
de l'utilisateur comme donnée associée : un secret déplacé vers un autre compte devient
inutilisable.

`confirmedAt` reste `null` tant que l'utilisateur n'a pas prouvé qu'il a enregistré le
secret. `lastUsedTimeStep` interdit le rejeu d'un code déjà consommé.

#### `RecoveryCode`

Dix codes par utilisateur, hachés en **Argon2id** — comme des mots de passe, pas comme
des jetons. `label` conserve les quatre premiers caractères pour l'affichage.

#### `Session`

| Colonne                               | Note                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `tokenHash`                           | SHA-256 du jeton. Le jeton brut n'existe que dans le cookie |
| `status`                              | `PENDING_MFA_ENROLLMENT` \| `PENDING_MFA` \| `ACTIVE`       |
| `authMethods`                         | `["password", "totp"]`, `["passkey"]`…                      |
| `elevatedUntil`                       | Fenêtre de réauthentification pour les opérations sensibles |
| `idleExpiresAt` / `absoluteExpiresAt` | Double expiration                                           |
| `ipHash`, `userAgentDigest`           | **HMAC**, jamais la valeur en clair                         |

Les deux statuts en attente sont ce qui rend la MFA réellement bloquante : une session
`PENDING_MFA_ENROLLMENT` n'atteint aucune donnée familiale.

### Famille et permissions

#### `FamilyMembership`

Le pivot du modèle. Un utilisateur devient membre d'une famille avec un rôle.

```prisma
@@unique([familyId, userId])   // une adhésion par famille
@@unique([id, familyId])       // cible des clés étrangères composites
```

**Index unique partiel** — au plus un propriétaire actif par famille :

```sql
CREATE UNIQUE INDEX family_single_active_owner
  ON "FamilyMembership" ("familyId")
  WHERE "role" = 'OWNER' AND "status" = 'ACTIVE';
```

Un transfert de propriété rétrograde l'ancien propriétaire **avant** de promouvoir le
nouveau, dans la même transaction : l'index n'est jamais violé.

**Suppression logique justifiée.** Un parent retiré passe en `REMOVED` plutôt que
d'être supprimé : le ledger et l'audit doivent continuer à indiquer qui a validé quoi.
C'est l'un des rares cas où la suppression logique est le bon choix.

#### `ChildProfile`

Données propres à un enfant, volontairement minimales : un avatar choisi parmi un jeu
d'illustrations embarquées et une couleur. **Aucun téléversement** : aucune image d'un
mineur n'est stockée.

`cachedBalance` est un **cache**. La source de vérité reste `PointTransaction`. Il est
mis à jour dans la même transaction SQL que le ledger, et la ligne est verrouillée
(`SELECT … FOR UPDATE`) pour sérialiser les validations concurrentes.

#### `Invitation`

Le « code famille ». Jeton à usage unique lié à **une** famille et **un** rôle cible.

| Propriété           | Mise en œuvre                                            |
| ------------------- | -------------------------------------------------------- |
| Cryptographique     | 24 caractères Crockford ≈ 120 bits                       |
| Non stocké en clair | SHA-256 uniquement — vérifié par test                    |
| Expirable           | `expiresAt`                                              |
| Usage unique        | `updateMany` conditionné à `status = PENDING`            |
| Révocable           | `status = REVOKED`                                       |
| Tracé               | `createdById`, `consumedByUserId`, `revokedById` + audit |

Un jeton `CHILD` ne peut pas créer un compte parent : le rôle est porté par le jeton,
et `consumeInvitation` exige que le rôle attendu corresponde.

### Tâches

#### `TaskDefinition`

Le modèle d'une tâche. `version` s'incrémente à chaque modification.

Trois récurrences : `ONE_OFF`, `DAILY`, `WEEKLY_DAYS`. La quatrième forme demandée —
« hebdomadaire » — est `WEEKLY_DAYS` avec un seul jour. Une RRULE complète serait
disproportionnée pour une V1 et difficile à rendre lisible dans l'interface.

Contraintes :

```sql
CHECK ("pointsAward" >= 0 AND "pointsPenalty" >= 0)
CHECK (recurrence <> 'WEEKLY_DAYS' OR array_length(weekdays, 1) BETWEEN 1 AND 7)
CHECK ((recurrence = 'ONE_OFF' AND "dueAt" IS NOT NULL)
    OR (recurrence <> 'ONE_OFF' AND "dueTime" IS NOT NULL))
```

#### `TaskOccurrence`

Une réalisation attendue, à une date donnée.

**Instantanés.** `titleSnapshot`, `pointsAwardSnapshot`, `pointsPenaltySnapshot` et
`definitionVersion` sont figés à la génération. Modifier le modèle ne réécrit jamais
le passé : une occurrence conserve le libellé et les points **annoncés** au moment où
elle a été créée.

**Idempotence.** `@@unique([taskDefinitionId, occurrenceDate])` : rejouer le job de
génération ne crée aucun doublon.

### Ledger

#### `PointTransaction` — append-only

| Colonne                  | Note                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `delta`                  | Signé. **Jamais zéro** (`CHECK`)                                      |
| `type`                   | `TASK_APPROVED` \| `TASK_MISSED` \| `MANUAL_ADJUSTMENT` \| `REVERSAL` |
| `sourceType`, `sourceId` | Origine : occurrence, manuel, annulation                              |
| `reason`                 | **Obligatoire** pour `MANUAL_ADJUSTMENT` et `REVERSAL` (`CHECK`)      |
| `approvedById`           | Le parent qui a décidé                                                |
| `reversesTransactionId`  | Unique : on n'annule qu'une fois                                      |
| `idempotencyKey`         | Unique, facultative : neutralise un double envoi                      |

La contrainte centrale :

```prisma
@@unique([sourceType, sourceId, type])
```

Une occurrence ne peut être créditée ni pénalisée deux fois, **même si deux parents
valident au même instant**. PostgreSQL traite les `NULL` comme distincts : les
ajustements manuels, dont `sourceId` est `null`, ne sont pas contraints.

### Règles

#### `RewardRule` / `RewardEvent`

```prisma
@@unique([rewardRuleId, childMembershipId])
```

Un palier n'est proposé **qu'une seule fois** par enfant. Le score peut donc franchir
le seuil, redescendre et le franchir à nouveau sans créer de doublon — y compris si le
parent avait choisi d'ignorer.

#### `SanctionRule` — le champ `armed`

La détection porte sur le **franchissement** du seuil, pas sur l'état.

- `armed = true` : le score est au-dessus du seuil, le prochain passage en dessous
  déclenchera une proposition ;
- au franchissement : une proposition est créée, puis `armed = false` ;
- tant que le score stagne sous le seuil : plus rien n'est proposé ;
- quand le score repasse au-dessus : `armed = true` à nouveau.

Sans ce champ, une règle reproposerait une sanction à chaque évaluation tant que le
score reste bas.

#### `SanctionInstance`

**Index unique partiel** — au plus un épisode ouvert par règle et par enfant :

```sql
CREATE UNIQUE INDEX sanction_single_open_instance
  ON "SanctionInstance" ("sanctionRuleId", "childMembershipId")
  WHERE "status" IN ('PROPOSED', 'ACTIVE', 'LIFT_ELIGIBLE');
```

Les conditions de levée sont **figées à l'activation** (`liftConditionType`, `liftAt`,
`liftScoreThreshold`) : modifier la règle plus tard ne change pas une sanction en cours.

### Audit et infrastructure

#### `AuditLog` — append-only

Distinct du ledger : celui-ci raconte les mouvements de points, celui-là raconte **qui
a décidé quoi**, y compris pour les opérations de sécurité.

`metadata` passe par une **liste blanche de clés** (`sanitizeMetadata`) : une clé
inconnue est ignorée. Impossible de faire fuiter accidentellement un champ sensible en
transmettant un objet trop large. Les clés explicitement interdites — `password`,
`token`, `secret`, `recoveryCode`, `invitationToken` — sont rejetées en plus.

#### `JobRun`

```prisma
@@unique([jobName, runKey])
```

`runKey` est le créneau horaire. Une double exécution sur le même créneau est refusée :
un job rejoué ne produit jamais deux pénalités ni deux propositions.

#### `RateLimitCounter`

Compteur en fenêtre fixe, stocké en base pour rester correct avec plusieurs instances
applicatives — ce qu'un compteur en mémoire ne serait pas. Pas de dépendance Redis en V1.

---

## Récapitulatif des garanties de la base

| Garantie                           | Mécanisme                                               |
| ---------------------------------- | ------------------------------------------------------- |
| Isolation entre familles           | Clé étrangère composite `(childMembershipId, familyId)` |
| Un seul propriétaire actif         | Index unique partiel                                    |
| Un seul épisode de sanction ouvert | Index unique partiel                                    |
| Ledger immuable                    | Trigger `BEFORE UPDATE OR DELETE`                       |
| Audit immuable                     | Trigger `BEFORE UPDATE OR DELETE`                       |
| Pas de double crédit               | Unique `(sourceType, sourceId, type)`                   |
| Pas de transaction nulle           | `CHECK (delta <> 0)`                                    |
| Motif obligatoire                  | `CHECK` sur `MANUAL_ADJUSTMENT` et `REVERSAL`           |
| Annulation unique                  | Unique sur `reversesTransactionId`                      |
| Génération idempotente             | Unique `(taskDefinitionId, occurrenceDate)`             |
| Palier obtenable une fois          | Unique `(rewardRuleId, childMembershipId)`              |
| Job non rejouable                  | Unique `(jobName, runKey)`                              |

---

## Index de performance

Au-delà des index implicites, le schéma en déclare pour les écrans réellement chargés :

- `TaskOccurrence(familyId, state, dueAt)` **partiel** sur les états en attente de
  décision — c'est la requête du tableau de bord parent ;
- `RewardEvent(familyId, proposedAt)` **partiel** sur `PENDING_PARENT_APPROVAL` ;
- `SanctionInstance(familyId, status)` **partiel** sur `PROPOSED` et `LIFT_ELIGIBLE` ;
- `Notification(recipientMembershipId, createdAt)` **partiel** sur les non lues ;
- `PointTransaction(familyId, createdAt)` et `(childMembershipId, createdAt)` pour
  l'historique paginé par curseur.

Les index partiels ne couvrent que les lignes réellement interrogées : ils restent
petits même quand l'historique grandit.
