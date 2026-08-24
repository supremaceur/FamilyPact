# État du projet

> Fichier vivant. À lire en début de session, à mettre à jour en fin de session.
> Il existe pour éviter de reparcourir le code afin de reconstruire un contexte
> déjà écrit.

**Dernière mise à jour** : 24 août 2026

## En production

|                  |                                                                      |
| ---------------- | -------------------------------------------------------------------- |
| URL              | `https://family-pact-virid.vercel.app`                               |
| Branche déployée | `main`                                                               |
| Base             | Supabase `xprspsckgdksbcdhjjxp`, région `eu-west-2`, PostgreSQL 17.6 |
| Connexion        | pooler transactionnel, port 6543                                     |
| Cron             | `0 19 * * *` UTC — quotidien, contrainte du plan Hobby               |

## Livré

| Domaine                                                           | État |
| ----------------------------------------------------------------- | ---- |
| Comptes parents, MFA TOTP obligatoire, codes de secours, passkeys | ✅   |
| Familles, adhésions, invitations, rôles et capacités              | ✅   |
| Tâches, récurrence, occurrences, registre de points, score        | ✅   |
| Moteur de règles : récompenses, sanctions, conditions de levée    | ✅   |
| Écrans parent et enfant                                           | ✅   |
| Jobs planifiés, journal d'audit, notifications                    | ✅   |
| Page d'accueil illustrée par de vraies captures                   | ✅   |
| PWA installable, mode hors-ligne                                  | ✅   |

## En cours

**PR #5 — second type de refus** (`claude/refus-avec-retrait`)

Deux refus au lieu d'un : sans effet sur les points, ou assorti du retrait déjà
configuré sur la tâche. Inclut la chronologie unifiée des historiques et une
correction du registre. Tout est vert ; reste la documentation avant fusion.

## Défauts connus

Aucun défaut ouvert à ce jour.

## Demandes en attente

| Demande                                    | Note                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rafraîchissement périodique de l'interface | Choix retenu : interrogation périodique (`router.refresh()` toutes les 15–20 s + au retour de focus). **Pas** Supabase Realtime — voir `DECISIONS.md`. |
| Révocation d'une récompense accordée       | Quand le score repasse sous le seuil qui l'avait déclenchée. Proposition, jamais automatique.                                                          |

## Points d'attention

- **La clé `service_role` Supabase doit être révoquée.** Elle a été transmise en
  clair dans une conversation. Ses privilèges sur les tables sont retirés, mais
  elle reste une clé d'administration valide du projet.
- Deux branches obsolètes traînent sur le dépôt :
  `claude/familiapact-pwa-build-5rqo3d` et `claude/familipact-v1`. La première
  contient d'anciens défauts corrigés depuis — **ne jamais la fusionner**.
- Les identifiants git de l'environnement d'exécution expirent en cours de
  session. Repli : l'API GitHub (`push_files`, `create_or_update_file`).

## Vérifications attendues avant toute fusion

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test:all
npm run build
```

Compte de référence au 24 août 2026 : **171 tests** (87 unitaires, 84
d'intégration) et **28 tests de bout en bout**.
