# État du projet

> Fichier vivant. À lire en début de session, à mettre à jour en fin de session.
> Il existe pour éviter de reparcourir le code afin de reconstruire un contexte
> déjà écrit.

**Dernière mise à jour** : 24 août 2026, 23 h

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
| Documentation vivante : `ETAT.md`, `DECISIONS.md`, `interface.md` | ✅   |
| Comptes parents, MFA TOTP obligatoire, codes de secours, passkeys | ✅   |
| Familles, adhésions, invitations, rôles et capacités              | ✅   |
| Tâches, récurrence, occurrences, registre de points, score        | ✅   |
| Moteur de règles : récompenses, sanctions, conditions de levée    | ✅   |
| Écrans parent et enfant                                           | ✅   |
| Jobs planifiés, journal d'audit, notifications                    | ✅   |
| Page d'accueil illustrée par de vraies captures                   | ✅   |
| PWA installable, mode hors-ligne                                  | ✅   |

## En cours

**PR #5 — second type de refus + direction « Ardoise »** (`claude/refus-avec-retrait`) — prête à fusionner

Trois choses liées dans la même livraison :

1. **Deux refus au lieu d'un** : sans effet sur les points, ou assorti du retrait
   déjà configuré sur la tâche. Le parent ne saisit aucun montant.
2. **Chronologie unifiée** : les écrans d'historique ne lisaient que le registre,
   donc un refus sans retrait n'apparaissait nulle part.
3. **Correction du registre** : le rattrapage après violation d'unicité
   interrogeait une transaction déjà avortée par PostgreSQL (`25P02`). Défaut
   préexistant, rendu atteignable par le refus avec retrait, trouvé par le test
   d'intégration. Voir `DECISIONS.md` D-007.

Puis l'habillage demandé, direction « Ardoise » :

4. **Largeur centralisée** : `PageBody` remplace vingt-deux `max-w-*` codés en
   dur. Trois largeurs seulement, choisies par ce que la page contient.
5. **Colonnes** : onze écrans répartissent désormais leur contenu en deux
   colonnes à partir de `xl` au lieu de l'empiler dans un couloir. Voir le
   tableau de répartition dans `interface.md`.
6. **Liseré teal sur tous les conteneurs**, plus marqué sur ce qui attend une
   décision. Relief porté par des jetons (`--card-ring`, `--card-surface`,
   `--card-inset`, `--app-backdrop`), donc modifiable en un point.

Puis le retrait d'une récompense :

7. **Deux natures de récompense**, déclarées à la création du palier
   (`RewardRule.revocable`) : ponctuelle — acquise pour de bon — ou qui dure,
   donc reprenable. Voir `DECISIONS.md` D-010.
8. **Le retrait est signalé, jamais appliqué** : la suggestion est recalculée à
   chaque affichage à partir du score, donc jamais figée. Motif obligatoire,
   aucun point rendu ni retiré, visible dans les deux historiques.

Et une correction sans rapport, trouvée en route :

9. **Les tests d'intégration construisaient « aujourd'hui » en UTC** alors que la
   famille de test est à Paris. Entre 22 h UTC et minuit ils fabriquaient donc la
   veille : dix-neuf tests tombaient, uniquement le soir. Ils passent désormais
   par `toLocalDate(new Date(), family.timeZone)`.

## Défauts connus

Aucun défaut ouvert à ce jour.

## Demandes en attente

| Demande                                    | Note                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rafraîchissement périodique de l'interface | Choix retenu : interrogation périodique (`router.refresh()` toutes les 15–20 s + au retour de focus). **Pas** Supabase Realtime — voir `DECISIONS.md`. |
| Révocation d'une récompense accordée       | ✅ Fait — seulement pour les récompenses déclarées « qui durent ». Signalée quand le score repasse sous le palier, jamais appliquée seule.             |
| Habillage visuel des écrans                | ✅ Fait — direction « Ardoise » retenue, appliquée aux 22 pages. Vérifié en clair et en sombre, à 1440 px et à 412 px.                                 |

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

Compte de référence au 24 août 2026 : **176 tests** (87 unitaires, 89
d'intégration) et **28 tests de bout en bout**.
