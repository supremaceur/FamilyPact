# Règles métier

Ce document décrit le comportement exact de FamiliPact. Chaque règle marquée
**impérative** est couverte par au moins un test automatisé, référencé en fin de
section.

---

## La règle qui gouverne toutes les autres

> **Le système détecte et propose. Le parent décide.**

Aucune sanction n'est activée, aucune récompense n'est accordée, aucun point n'est
retiré sans une action explicite d'un parent autorisé.

Cette règle est **structurelle** :

- le moteur de règles (`src/domain/rules-engine.ts`) ne produit que des intentions de
  _proposition_ ; il n'existe aucune intention « accorder » ou « activer » ;
- `ledgerEffectOf()` ne renvoie un delta que pour deux transitions, `APPROVE` et
  `CONFIRM_MISSED`, toutes deux déclenchées par un parent ;
- le job d'échéance change un état et n'écrit jamais au ledger.

---

## 1. Tâches

### Cycle de vie

Un **modèle** de tâche (`TaskDefinition`) engendre des **occurrences**
(`TaskOccurrence`), une par date d'application. Chaque occurrence porte son propre
historique : c'est ce qui permet de tracer chaque réalisation séparément.

### Récurrences

| Type          | Comportement                                                    |
| ------------- | --------------------------------------------------------------- |
| `ONE_OFF`     | Une seule occurrence, à la date d'effet, avec `dueAt` absolu    |
| `DAILY`       | Une occurrence par jour                                         |
| `WEEKLY_DAYS` | Une occurrence les jours ISO choisis (1 = lundi … 7 = dimanche) |

Une tâche « hebdomadaire » est un `WEEKLY_DAYS` avec un seul jour.

Les occurrences sont générées **30 jours à l'avance**, jamais rétroactivement : une
tâche créée aujourd'hui ne fait pas apparaître d'échéances déjà manquées hier.

### Modification d'un modèle — impératif

**Modifier un modèle ne réécrit jamais le passé.**

Chaque occurrence fige à sa création `titleSnapshot`, `pointsAwardSnapshot`,
`pointsPenaltySnapshot` et `definitionVersion`. À la modification :

- `version` s'incrémente ;
- les occurrences **futures encore à faire** sont supprimées puis régénérées ;
- les occurrences passées, déclarées, décidées ou jugées **ne bougent pas**.

Un enfant qui a fait une tâche annoncée à +20 points reçoit +20, même si le parent l'a
depuis passée à +5.

### Machine d'état — impératif

```
                    ┌──────────────────┐
                    │       TODO       │
                    └────┬────────┬────┘
       « J'ai terminé »  │        │  échéance dépassée (job)
                         ▼        ▼
              ┌──────────────┐  ┌────────────────────────┐
              │ CLAIMED_DONE │  │ MISSED_PENDING_REVIEW  │
              └───┬──────┬───┘  └──────┬──────────┬──────┘
     parent valide│      │parent refuse│ confirme │ ignore
                  ▼      ▼             ▼          ▼
          ┌──────────┐ ┌──────────┐ ┌──────────────────┐ ┌─────────────────┐
          │ APPROVED │ │ REJECTED │ │ MISSED_CONFIRMED │ │ MISSED_IGNORED  │
          │  +points │ │  0 point │ │     −points      │ │    0 point      │
          └──────────┘ └────┬─────┘ └──────────────────┘ └─────────────────┘
                            │
                   re-déclarable ou détectable comme manquée
```

**Deux transitions seulement écrivent au ledger**, et toutes deux exigent une décision
parentale :

| Transition                                 | Effet                    | Permission requise    |
| ------------------------------------------ | ------------------------ | --------------------- |
| `CLAIMED_DONE → APPROVED`                  | `+pointsAwardSnapshot`   | `TASK_APPROVE`        |
| `MISSED_PENDING_REVIEW → MISSED_CONFIRMED` | `−pointsPenaltySnapshot` | `TASK_CONFIRM_MISSED` |

Aucune autre transition ne touche au score. Une tâche qui vaut 0 point n'écrit rien.

### Échéance dépassée — impératif

Quand l'échéance passe sans réalisation validée, **aucun point n'est retiré**.

Le job crée l'état `MISSED_PENDING_REVIEW` et notifie les parents habilités. Le
tableau de bord affiche :

```
Ranger la chambre — non déclarée terminée
Retrait prévu : −10 points
[ Confirmer −10 ]   [ Ignorer ]
```

- **Confirmer** → `MISSED_CONFIRMED`, transaction `−10`, audit.
- **Ignorer** → `MISSED_IGNORED`, **aucune transaction**, audit tout de même.

> Tests : `src/domain/tasks.test.ts`, `tests/integration/ledger-and-tasks.test.ts`
> (cas A, C, D), `tests/integration/jobs.test.ts`.

---

## 2. Ledger de points

### Le score est la somme des transactions

Il n'existe aucun compteur modifiable à la main. `ChildProfile.cachedBalance` est un
cache, mis à jour dans la **même transaction SQL** que l'écriture du ledger, et
recalculable à tout moment.

### Composition d'une transaction

| Champ                     | Contenu                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `delta`                   | Signé, **jamais zéro**                                                |
| `type`                    | `TASK_APPROVED` \| `TASK_MISSED` \| `MANUAL_ADJUSTMENT` \| `REVERSAL` |
| `sourceType` / `sourceId` | Occurrence, manuel, ou transaction annulée                            |
| `label`, `reason`         | Motif **obligatoire** pour les corrections                            |
| `approvedById`            | Le parent qui a décidé                                                |
| `reversesTransactionId`   | Renseigné pour une annulation                                         |

### Le score n'est pas borné à zéro

Choix produit explicite : si les règles familiales conduisent à un score négatif, il
devient négatif. `clampBalance()` existe pour rendre cette décision visible dans le
code plutôt que subie.

### Corrections — impératif

**Une transaction historique n'est jamais modifiée.** Le trigger PostgreSQL rejette
tout `UPDATE` et tout `DELETE`.

Deux opérations de correction, toutes deux avec motif obligatoire :

**Ajustement manuel** — ajoute une ligne, sans lien avec une transaction existante.

**Annulation** — ajoute la ligne inverse d'une transaction donnée :

```
24/08 18:42   +20   Devoirs                        validé par Marie
25/08 09:15   −20   Annulation — Devoirs           Marie
                    Motif : validée par erreur, la tâche n'était pas faite
```

L'erreur **et** sa correction restent visibles, avec auteur, date et motif. Une
annulation ne peut pas être annulée : il faut un nouvel ajustement manuel.

### Concurrence — impératif

Deux parents cliquant simultanément sur « Valider +20 » produisent **une seule**
transaction de +20. Quatre mécanismes se cumulent :

1. `SELECT … FOR UPDATE` sur `ChildProfile` sérialise les écritures pour un enfant ;
2. l'index unique `(sourceType, sourceId, type)` interdit le doublon ;
3. la mise à jour d'état est conditionnée à l'état attendu ;
4. la violation d'unicité est traduite en résultat « déjà appliqué », pas en erreur.

La seconde décision renvoie `alreadyDecided: true` et l'interface affiche « Cette
décision a déjà été prise par un autre parent ».

> Tests : `src/domain/points.test.ts`, `tests/integration/ledger-and-tasks.test.ts`
> (cas A et B, dont quatre validations simultanées).

---

## 3. Récompenses

### Le système propose, il n'accorde jamais

Quand le score atteint le palier d'une règle active, le moteur crée un `RewardEvent`
en statut `PENDING_PARENT_APPROVAL`. Le parent **valide** ou **ignore**.

### Obtenable une seule fois — impératif

`@@unique([rewardRuleId, childMembershipId])` garantit qu'un palier ne donne lieu
qu'à un seul événement, **quel que soit son statut**.

Conséquence : si le score franchit 500, redescend à 480 puis remonte à 510, la
récompense n'est **pas** reproposée. Un palier ignoré ne l'est pas non plus.

### Une récompense obtenue est acquise

Elle n'est jamais retirée si le score redescend ensuite. C'est un fait, pas un état.

### Aucun point n'est consommé — impératif

Les points de FamiliPact sont un **score de progression**, pas une monnaie. Valider
une récompense ne débite rien : il n'existe aucun mécanisme
`500 points − achat 200 = 300 points`. La progression vers le palier suivant reste
donc lisible.

### Prochaine récompense

Le tableau de bord affiche le palier actif le plus bas n'ayant pas encore donné lieu à
un événement :

```
Prochaine récompense : Sortie cinéma
375 / 500 points
125 points restants
```

S'il n'en reste aucune, l'interface affiche un état vide honnête. Elle **n'invente
jamais** d'objectif.

> Tests : `src/domain/rules-engine.test.ts`,
> `tests/integration/rules-engine.test.ts` (cas E et F).

---

## 4. Sanctions

### FamiliPact n'applique aucune sanction — impératif

L'application enregistre, calcule et affiche. Elle ne bloque aucun téléphone, aucune
application, aucun accès. La mise en œuvre relève entièrement du parent. Ce rappel est
affiché en permanence sur l'écran des sanctions.

### Chaîne complète

```
seuil franchi
    → PROPOSED        (système)
    → décision parentale
        ├─ ignorer  → IGNORED     (terminal, aucun effet)
        └─ activer  → ACTIVE
                        → condition de levée atteinte
                        → LIFT_ELIGIBLE   (système : signale, ne lève pas)
                        → décision parentale
                        → LIFTED
```

**Deux décisions parentales** sont nécessaires : une pour activer, une pour lever.

### Détection par franchissement — impératif

Le déclenchement porte sur la **transition**, pas sur l'état. Le champ
`SanctionRule.armed` porte cette logique :

| Situation                     | `armed`        | Effet                          |
| ----------------------------- | -------------- | ------------------------------ |
| Score au-dessus du seuil      | `true`         | En attente d'un franchissement |
| Score passe sous le seuil     | `true → false` | **Une** proposition créée      |
| Score reste sous le seuil     | `false`        | Rien — pas de reproposition    |
| Score repasse au-dessus       | `false → true` | Réarmée                        |
| Nouveau passage sous le seuil | `true → false` | Nouvelle proposition légitime  |

Une règle naît toujours armée : l'évaluation qui suit immédiatement sa création décide.
Si le score est déjà sous le seuil au moment où le parent crée la règle, une
proposition est produite sur-le-champ — le parent décrit une situation qu'il constate,
il attend une réponse.

De plus, l'index unique partiel garantit **au plus un épisode ouvert** par règle et par
enfant, quelles que soient les oscillations du score.

### Conditions de levée

Figées **à l'activation** : modifier la règle ensuite ne change pas une sanction en
cours.

| Type             | Condition                                                 |
| ---------------- | --------------------------------------------------------- |
| `MANUAL`         | Jamais satisfaite automatiquement — le parent décide seul |
| `DATE`           | `maintenant >= liftAt`                                    |
| `SCORE`          | `score >= liftScoreThreshold`                             |
| `DATE_AND_SCORE` | Les deux                                                  |
| `DATE_OR_SCORE`  | L'une des deux                                            |

### La condition atteinte ne lève rien — impératif

Quand la condition est satisfaite, la sanction passe en `LIFT_ELIGIBLE` et le parent
est notifié :

> Condition de levée atteinte — validation requise.

Elle **reste active** tant que le parent n'a pas cliqué sur « Lever ».

**Une sanction éligible le reste**, même si le score redescend : le parent a été
informé, l'information ne doit pas clignoter.

**Le parent peut lever à tout moment**, y compris depuis `ACTIVE` avant que la
condition soit atteinte. Son autorité prime sur la condition automatique.

### Historisation

Chaque instance conserve : date de proposition et score au franchissement, date
d'activation et parent activateur, conditions de levée résolues, date d'éligibilité,
date de levée réelle et parent qui a levé.

> Tests : `src/domain/rules-engine.test.ts`,
> `tests/integration/rules-engine.test.ts` (cas G et H).

---

## 5. Moteur de règles

`evaluate()` est **pur et déterministe** : mêmes entrées, mêmes sorties, aucun effet
de bord, aucune lecture d'horloge non fournie.

**Entrées** — score, instant, règles de récompense, règles de sanction, sanctions actives.

**Sorties** — quatre listes d'intentions :

| Sortie              | Contenu                                                   |
| ------------------- | --------------------------------------------------------- |
| `rewardProposals`   | Paliers atteints n'ayant jamais donné lieu à un événement |
| `sanctionProposals` | Seuils franchis avec règle armée et aucun épisode ouvert  |
| `armingChanges`     | Réarmements et désarmements à appliquer                   |
| `liftEligibilities` | Sanctions actives dont la condition est satisfaite        |

Il n'existe **aucune** sortie « accorder », « activer » ou « lever ». Ce n'est pas un
oubli : c'est ce qui rend impossible une décision automatique.

**Quand est-il appelé ?**

- après **chaque** variation de score, dans la même transaction SQL — un score modifié
  sans réévaluation laisserait passer un palier ;
- par le job horaire, pour les conditions de levée à base de **date**, qui ne dépendent
  que du temps qui passe ;
- à la création ou à la modification d'une règle.

---

## 6. Jobs planifiés

Quatre jobs, exécutés dans cet ordre, **idempotents par créneau horaire** grâce à
`JobRun(jobName, runKey)`.

| Job                    | Rôle                                                                  | Écrit au ledger ? |
| ---------------------- | --------------------------------------------------------------------- | ----------------- |
| `generate-occurrences` | Matérialise les occurrences à venir, dans le fuseau de chaque famille | Non               |
| `detect-missed`        | Marque les échéances dépassées `MISSED_PENDING_REVIEW`                | **Non**           |
| `evaluate-rules`       | Réévalue paliers et conditions de levée                               | Non               |
| `purge-expired`        | Nettoie compteurs, défis WebAuthn et sessions expirés                 | Non               |

**Aucun job n'écrit au ledger.** Une double exécution ne produit ni double pénalité,
ni double proposition — vérifié par test, y compris sous déclenchements simultanés.

> Tests : `tests/integration/jobs.test.ts`.

---

## 7. Ce qui n'existe pas en V1

Volontairement absent, conformément au cahier des charges :

**Contrôle technique** — aucun blocage d'appareil, d'application ou d'accès Internet ;
aucun contrôle de temps d'écran, de routeur ou d'appels ; aucune géolocalisation ;
aucune lecture de messages ; aucune surveillance de navigation.

**Gamification** — aucun badge, aucun niveau, aucun XP, aucune série quotidienne,
aucun trophée, aucun classement entre enfants, aucun concours.

**Économie** — aucun catalogue de points dépensables, aucune monnaie virtuelle.

**Social** — aucun chat familial, aucun réseau social, aucun système de contestation
enfant.

**Automatisation des décisions** — aucune IA décisionnaire, aucune sanction
automatiquement appliquée, aucune récompense automatiquement accordée.

Ces absences ne sont pas des lacunes : ce sont des choix de produit. Aucun code
inactif ni aucune amorce de ces fonctionnalités n'a été laissé dans le dépôt.

---

## 8. Correspondance avec les cas exigés

| Cas | Scénario                                                   | Vérifié par                                 |
| --- | ---------------------------------------------------------- | ------------------------------------------- |
| A   | 100 pts, tâche +20 validée → 120, une transaction          | `ledger-and-tasks.test.ts`                  |
| B   | Deux parents valident simultanément → +20 une fois         | `ledger-and-tasks.test.ts` (2 et 4 parents) |
| C   | Échéance −10 dépassée → aucun retrait ; confirmation → −10 | `ledger-and-tasks.test.ts`                  |
| D   | Échéance dépassée puis « Ignorer » → aucune transaction    | `ledger-and-tasks.test.ts`                  |
| E   | Palier 500, 490 → 510 : proposition, puis validation       | `rules-engine.test.ts`                      |
| F   | Score 510 → 480 → 510 : pas de reproposition               | `rules-engine.test.ts`                      |
| G   | Seuil < 100, score 105 → 95 : proposition, rien d'actif    | `rules-engine.test.ts`                      |
| H   | Levée à 150 atteinte : éligible, puis levée par le parent  | `rules-engine.test.ts`                      |
| I   | Jeton réutilisé → refus (dont 5 tentatives simultanées)    | `isolation-and-invitations.test.ts`         |
| J   | Famille A → ressource de Famille B → refus serveur         | `isolation-and-invitations.test.ts`         |
