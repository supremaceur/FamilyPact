@AGENTS.md

# FamiliPact — repères permanents

Ce fichier est chargé à chaque session. Il reste court **volontairement** : son
rôle est de rappeler ce qui ne se devine pas, et d'indiquer où lire le reste.

Avant toute chose : lire **`docs/ETAT.md`**. C'est l'état vivant du projet — ce
qui est livré, ce qui est en cours, ce qui est cassé. Il évite de reparcourir le
code pour reconstruire un contexte déjà écrit.

## La règle qui prime sur tout

> L'application calcule. L'application informe. L'application propose.
> **Le parent décide.**

Ce n'est pas un slogan, c'est vérifiable :

- aucune sanction, aucune récompense, aucun retrait de points ne s'applique sans
  une action explicite d'un parent autorisé ;
- une échéance dépassée ne déduit **jamais** de points : elle crée un
  `MISSED_PENDING_REVIEW` qui attend une décision, et que le parent peut ignorer ;
- un enfant ne peut jamais s'attribuer de points.

Toute évolution qui automatiserait une de ces décisions est à refuser, même
demandée comme une commodité. La proposer autrement, oui ; la décider à la place
du parent, non.

## Ce que FamiliPact n'est pas

Pas un contrôle parental technique : aucun blocage d'appareil ou d'application,
aucune localisation, aucun contrôle du temps d'écran, aucune lecture de
messages. Pas de ludification non plus : ni badges, ni niveaux, ni séries, ni
classement entre enfants. Les points sont un **repérage de progression**, pas
une monnaie — il n'existe pas de catalogue où l'on dépense un solde.

## Où chercher

| Question                                           | Fichier                  |
| -------------------------------------------------- | ------------------------ |
| Où en est le projet, qu'est-ce qui est cassé       | `docs/ETAT.md`           |
| Pourquoi tel choix a été fait                      | `docs/DECISIONS.md`      |
| Règles métier, machine à états, cas A à K          | `docs/business-rules.md` |
| Schéma, index, contraintes                         | `docs/data-model.md`     |
| Isolation, chiffrement, surface d'attaque          | `docs/security.md`       |
| Sessions, MFA, WebAuthn                            | `docs/authentication.md` |
| Rôles et capacités                                 | `docs/permissions.md`    |
| Variables d'environnement, Vercel, Supabase, cron  | `docs/deployment.md`     |
| Palette, composants, accessibilité, ton des textes | `docs/interface.md`      |
| Découpage des couches                              | `docs/architecture.md`   |
| Données personnelles, RGPD                         | `docs/privacy.md`        |

## Contraintes d'environnement à ne pas redécouvrir

- **Supabase n'est qu'un hébergeur PostgreSQL.** Ni Supabase Auth, ni PostgREST,
  ni client `@supabase/*`. Les privilèges des rôles `anon`, `authenticated` et
  `service_role` sont **révoqués**, et la RLS est active sans aucune politique :
  c'est voulu. Ne pas « corriger » les alertes du linter en ajoutant des
  politiques.
- **Vercel, plan Hobby** : un seul cron par jour, et les fonctions sont coupées à
  60 s. `vercel.json` planifie `0 19 * * *` (UTC).
- **`CRON_SECRET` doit valoir exactement `JOB_RUNNER_TOKEN`**, sinon le cron
  s'exécute et reçoit 403 — silencieusement.
- **`APP_ORIGIN` doit valoir exactement l'URL de production**, sans barre finale :
  la vérification d'origine compare caractère pour caractère.

## Tenue du projet

- Après chaque évolution : mettre à jour `docs/ETAT.md`, et ajouter une entrée à
  `docs/DECISIONS.md` si un choix structurant a été fait.
- Avant de pousser :
  `npm run format:check && npm run lint && npm run typecheck && npm run test:all`,
  puis `npm run build`.
- Le français des **textes affichés** est sans accents dans le code source, par
  cohérence avec l'existant. Les documents Markdown, eux, sont accentués.
