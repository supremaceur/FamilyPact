# Permissions

La matrice RBAC vit dans **un seul fichier** : `src/domain/permissions.ts`. Elle est
pure, testable sans base, et interrogée par la couche service avant **toute** écriture.

> Un contrôle uniquement côté interface n'a aucune valeur. Masquer un bouton n'empêche
> personne d'appeler l'API. Toute décision passe par `can()` côté serveur.

---

## Les quatre rôles

| Rôle       | Portée                                                               |
| ---------- | -------------------------------------------------------------------- |
| **OWNER**  | Tout, y compris la composition de la famille et sa suppression       |
| **ADMIN**  | Tout l'opérationnel familial, rien qui touche à la famille elle-même |
| **PARENT** | Uniquement ce que le propriétaire lui a explicitement accordé        |
| **CHILD**  | Aucune capacité d'administration, sans exception                     |

Il existe **exactement un** propriétaire actif par famille. Cet invariant tient au
niveau de la base, par un index unique partiel. Le propriétaire ne peut pas quitter la
famille sans avoir d'abord transféré la propriété.

---

## Matrice complète

### Permissions octroyables

Ces onze permissions constituent l'énumération `ParentPermission`. Elles sont
octroyables individuellement à un membre `PARENT`.

| Permission               | OWNER | ADMIN |     PARENT      | CHILD | Ce qu'elle autorise                                  |
| ------------------------ | :---: | :---: | :-------------: | :---: | ---------------------------------------------------- |
| `TASK_MANAGE`            |  ✅   |  ✅   |       ⚙️        |  ❌   | Créer, modifier, activer ou archiver les tâches      |
| `TASK_APPROVE`           |  ✅   |  ✅   | ⚙️ **(défaut)** |  ❌   | Valider ou refuser une tâche déclarée terminée       |
| `TASK_CONFIRM_MISSED`    |  ✅   |  ✅   | ⚙️ **(défaut)** |  ❌   | Confirmer ou ignorer un retrait                      |
| `POINTS_ADJUST`          |  ✅   |  ✅   |       ⚙️        |  ❌   | Ajuster un score avec motif, annuler une transaction |
| `RULE_MANAGE`            |  ✅   |  ✅   |       ⚙️        |  ❌   | Définir paliers et seuils                            |
| `REWARD_APPROVE`         |  ✅   |  ✅   |       ⚙️        |  ❌   | Valider ou ignorer une récompense proposée           |
| `SANCTION_ACTIVATE`      |  ✅   |  ✅   |       ⚙️        |  ❌   | Activer ou ignorer une sanction proposée             |
| `SANCTION_LIFT`          |  ✅   |  ✅   |       ⚙️        |  ❌   | Lever une sanction active                            |
| `CHILD_MANAGE`           |  ✅   |  ✅   |       ⚙️        |  ❌   | Inviter, modifier ou supprimer un enfant             |
| `FAMILY_SETTINGS_MANAGE` |  ✅   |  ✅   |       ⚙️        |  ❌   | Nom et fuseau horaire de la famille                  |
| `AUDIT_VIEW`             |  ✅   |  ✅   |       ⚙️        |  ❌   | Consulter le journal d'audit                         |

✅ hérité du rôle · ⚙️ octroyable individuellement · ❌ jamais

### Capacités réservées au propriétaire

Ces quatre capacités **ne figurent pas** dans `ParentPermission`. Elles ne sont donc
pas octroyables — par construction, pas par convention.

| Capacité             | OWNER | ADMIN | PARENT | CHILD | Réauth. |
| -------------------- | :---: | :---: | :----: | :---: | :-----: |
| `MEMBER_MANAGE`      |  ✅   |  ❌   |   ❌   |  ❌   |   🔐    |
| `PERMISSION_MANAGE`  |  ✅   |  ❌   |   ❌   |  ❌   |   🔐    |
| `OWNERSHIP_TRANSFER` |  ✅   |  ❌   |   ❌   |  ❌   |   🔐    |
| `FAMILY_DELETE`      |  ✅   |  ❌   |   ❌   |  ❌   |   🔐    |

🔐 exige une réauthentification récente (10 minutes).

---

## Les décisions de conception

### Pourquoi ADMIN n'a pas `MEMBER_MANAGE`

Le cahier des charges décrit l'administrateur comme pouvant gérer « enfants, tâches,
validations, points, règles, récompenses, sanctions » — une liste opérationnelle. Il
attribue au propriétaire « parents, invitations, permissions, transfert, suppression ».

Un administrateur qui pourrait inviter un autre administrateur, ou modifier les
permissions d'un parent, deviendrait de fait co-propriétaire. La distinction entre les
deux rôles disparaîtrait.

### Pourquoi les capacités du propriétaire ne sont pas dans l'énumération

Si `MEMBER_MANAGE` était une `ParentPermission`, il deviendrait possible — par erreur
d'interface ou par une requête forgée — de l'accorder à un membre `PARENT`. En la
plaçant dans un type distinct, `can()` la traite par une branche séparée qui exige
`role === OWNER` :

```ts
if (!isParentPermission(capability)) {
  return subject.role === FamilyRole.OWNER;
}
```

Il n'existe aucun chemin de code capable de l'octroyer.

### Pourquoi un enfant n'a rien, même avec des lignes en base

```ts
if (subject.role === FamilyRole.CHILD) return false;
```

Cette ligne précède toute autre vérification. Même si des lignes `ParentPermissionGrant`
existaient pour un enfant — incident, migration ratée, écriture directe — elles
resteraient sans effet. C'est vérifié par un test qui donne délibérément **toutes** les
permissions à un enfant et confirme qu'il n'en exerce aucune.

### Permissions par défaut d'un parent invité

```ts
DEFAULT_PARENT_PERMISSIONS = [TASK_APPROVE, TASK_CONFIRM_MISSED];
```

Un parent invité peut participer aux validations quotidiennes — c'est l'usage courant —
mais pas redéfinir le cadre familial. Il ne peut ni créer de tâches, ni ajuster des
points, ni modifier les règles tant que le propriétaire ne le lui accorde pas.

Ce choix suit le principe du moindre privilège : partir de la base et élargir, plutôt
que partir de tout et restreindre.

---

## Application côté serveur

### Le point de passage unique

```ts
const actor = await requireParentActor(); // 1. session complète + MFA
requireCapability(actor, ParentPermission.TASK_APPROVE); // 2. permission + step-up
// 3. seulement ici, la logique métier
```

`requireCapability()` vérifie **deux** choses :

1. la capacité, via `can()` ;
2. si la capacité est sensible, la fraîcheur de la réauthentification.

Une action sensible sans session élevée lève `STEP_UP_REQUIRED`. L'interface affiche
alors l'invite de vérification et rejoue l'opération.

### Ce que fait `requireFamilyActor`

Il résout l'adhésion de l'utilisateur connecté et renvoie un `FamilyActor` portant
`familyId`, `membershipId`, `role` et `permissions`.

**Le `familyId` utilisé partout ensuite vient de l'adhésion, jamais du client.** C'est
ce qui rend l'isolation entre familles structurelle plutôt que déclarative.

Trois variantes :

| Fonction               | Usage                                    |
| ---------------------- | ---------------------------------------- |
| `requireFamilyActor()` | N'importe quel membre                    |
| `requireParentActor()` | Refuse explicitement les comptes enfants |
| `requireChildActor()`  | Refuse explicitement les comptes parents |

### Rôle de l'interface

L'interface **reflète** les permissions, elle ne les applique pas. `hasCapability()`
sert uniquement à masquer un bouton qui échouerait de toute façon. Les pages sensibles
revérifient côté serveur :

```tsx
const actor = await requireParentActor();
// Vérification côté serveur : masquer le lien ne suffirait pas.
if (!hasCapability(actor, ParentPermission.TASK_MANAGE)) redirect('/parent/taches');
```

---

## Vérification

| Aspect                                          | Où                                                    |
| ----------------------------------------------- | ----------------------------------------------------- |
| Matrice complète, quatre rôles                  | `src/domain/permissions.test.ts`                      |
| Enfant sans capacité malgré des octrois         | idem                                                  |
| Opérations sensibles correctement marquées      | idem                                                  |
| Refus d'un parent sans permission               | `tests/integration/ledger-and-tasks.test.ts`          |
| Refus d'un enfant validant sa propre tâche      | idem                                                  |
| Refus d'un admin sur les capacités propriétaire | `tests/integration/isolation-and-invitations.test.ts` |
| Refus sans réauthentification récente           | idem                                                  |
