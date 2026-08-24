# Journal des décisions

> Une entrée par choix structurant. Ajout en tête, jamais de réécriture : une
> décision revenue sur ses pas devient une nouvelle entrée qui remplace la
> précédente, laquelle reste lisible.
>
> Format : **la décision**, _pourquoi_, ce que ça coûte.

---

## D-009 — Interrogation périodique plutôt que Supabase Realtime

**Décision.** Le rafraîchissement en direct passera par une interrogation
périodique côté client (`router.refresh()`), pas par Supabase Realtime.

**Pourquoi.** Realtime pousse les changements PostgreSQL vers le **navigateur**,
ce qui suppose deux choses délibérément supprimées : des privilèges pour le rôle
`anon` sur les tables, et des politiques RLS écrites avec `auth.uid()` — fourni
par Supabase Auth, que le projet n'utilise pas. L'adopter reviendrait à démonter
l'isolation familiale côté serveur pour la reconstruire côté base, en confiant
au navigateur des identifiants qu'il n'a aujourd'hui jamais.

**Ce que ça coûte.** Une latence de 15 à 20 secondes au lieu de l'instantané.
Acceptable pour un usage familial. Le SSE redeviendra envisageable sur un plan
Vercel qui ne coupe pas les fonctions à 60 s.

## D-008 — Deux types de refus, même état, deux conséquences

**Décision.** « Refuser » se décline en deux actions : sans effet sur les
points, ou assortie du retrait déjà configuré sur la tâche. Les deux mènent à
`REJECTED` ; seule l'écriture au registre les distingue. Le type de mouvement
est `TASK_REJECTED`, distinct de `TASK_MISSED`.

**Pourquoi.** Un parent constatant qu'une tâche déclarée terminée ne l'est pas
n'avait que deux options : valider à tort, ou refuser sans effet. Le montant
reste celui configuré sur la tâche — le parent ne saisit rien, il applique une
conséquence déjà convenue. La règle du produit tient donc. Le type distinct
garde l'historique lisible et rend les deux retraits indépendants vis-à-vis de
l'index unique `(sourceType, sourceId, type)`.

**Ce que ça coûte.** Trois valeurs d'énumération ajoutées en base, et un
troisième bouton — affiché seulement si la tâche a un retrait configuré.

## D-007 — Vérifier avant d'insérer au registre, plutôt que rattraper après

**Décision.** `appendTransaction` vérifie l'existence d'un mouvement identique
**avant** l'insertion, et non dans un bloc `catch`.

**Pourquoi.** PostgreSQL avorte la transaction entière dès qu'une instruction
échoue : après une violation d'unicité, toute commande suivante est refusée avec
`25P02`, y compris la lecture qui servirait au rattrapage. Celui-ci ne pouvait
donc jamais aboutir. La vérification préalable est exempte de course grâce au
verrou `lockChildBalance`, par lequel passe toute écriture au registre pour un
enfant donné.

**Ce que ça coûte.** Une lecture supplémentaire par écriture. La vérification ne
porte que sur les lignes dont `sourceId` n'est pas nul : PostgreSQL considère
les `NULL` comme distincts, donc les ajustements manuels ne sont pas contraints
et plusieurs peuvent légitimement coexister.

## D-006 — Cron quotidien, imposé par le plan Hobby

**Décision.** `vercel.json` planifie `0 19 * * *` (UTC) et non un pas horaire.

**Pourquoi.** Le plan Hobby refuse plus d'une exécution par jour et fait échouer
le **déploiement entier**, pas seulement le cron. Aucun job ne raisonne sur une
fenêtre glissante : `detect-missed` filtre sur `dueAt < now` sans borne
inférieure, la génération d'occurrences travaille à 30 jours. Espacer ne perd
donc rien.

**Ce que ça coûte.** De la latence de détection, jamais de perte. Une échéance
dépassée le matin apparaît le soir dans « Actions requises ».

## D-005 — Fermeture complète de la surface REST Supabase

**Décision.** Tous les privilèges des rôles `anon`, `authenticated` et
`service_role` sont révoqués sur le schéma `public`, et la RLS est activée sur
toutes les tables **sans aucune politique**.

**Pourquoi.** `service_role` contourne la RLS. Un privilège oublié exposait donc
empreintes de mots de passe, secrets TOTP et jetons de session à quiconque
détenait la clé. L'application se connecte en `postgres`, propriétaire des
tables et porteur de `rolbypassrls` : elle n'est pas affectée.

**Ce que ça coûte.** Le linter Supabase signale 23 alertes `rls_enabled_no_policy`
en niveau INFO. Elles sont **voulues** : ajouter des politiques pour les faire
taire rouvrirait ce que la fermeture verrouille.

## D-004 — Isolation familiale portée par des clés étrangères composites

**Décision.** Les liens vers un enfant sont composites : `(childMembershipId,
familyId)` référence `FamilyMembership(id, familyId)`.

**Pourquoi.** Une écriture inter-familles est ainsi rejetée par PostgreSQL, pas
seulement par le code applicatif. L'isolation ne dépend d'aucune vérification
qu'on pourrait oublier d'écrire.

**Ce que ça coûte.** Des `onDelete: SetNull` impossibles sur ces liens, puisque
`familyId` est non nul. Les clés désignant un acteur restent donc simples.

## D-003 — Registre en ajout seul, avec une échappatoire nommée

**Décision.** Un déclencheur PL/pgSQL refuse `UPDATE` et `DELETE` sur les tables
historiques. Une échappatoire explicite existe : `SET LOCAL familipact.purge = 'on'`.

**Pourquoi.** Un historique de points qu'on peut réécrire ne vaut rien. La seule
raison légitime de supprimer est l'effacement RGPD, et elle doit se voir dans le
code qui l'exerce.

**Ce que ça coûte.** Toute correction passe par une écriture compensatoire de
type `REVERSAL`, jamais par une modification.

## D-002 — Double authentification structurellement bloquante

**Décision.** Les états de session `PENDING_MFA_ENROLLMENT` / `PENDING_MFA` /
`ACTIVE` conditionnent l'accès aux données familiales.

**Pourquoi.** Une MFA que l'on peut repousser n'est pas une MFA. L'état de la
session rend le contournement impossible, pas seulement improbable.

**Ce que ça coûte.** Un parent ne peut rien faire avant d'avoir enrôlé une
application d'authentification. La clé est affichée en clair sous le QR code
pour ceux qui ne peuvent pas le scanner.

## D-001 — TypeScript 6, pas 7

**Décision.** Le projet reste sur TypeScript 6.

**Pourquoi.** L'écosystème de lint et les greffons Prisma n'étaient pas prêts au
moment du choix.

**Ce que ça coûte.** À réévaluer lorsque `typescript-eslint` suivra.
