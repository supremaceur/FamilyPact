# Confidentialité et données personnelles

FamiliPact traite des données concernant des **mineurs**. Ce document décrit
exactement ce qui est collecté, ce qui ne l'est pas, et pourquoi.

---

## Principe : ne collecter que le nécessaire

La question posée pour chaque champ n'est pas « ce serait utile ? » mais
**« l'application peut-elle fonctionner sans ? »**. Si oui, le champ n'existe pas.

Ce n'est pas une politique déclarative : les champs correspondants sont **absents du
schéma**. Il n'y a rien à désactiver, rien à purger — la colonne n'a jamais existé.

---

## Ce qui est collecté

### Compte parent

| Donnée                     | Pourquoi                                                   | Durée                    |
| -------------------------- | ---------------------------------------------------------- | ------------------------ |
| Adresse e-mail             | Identifiant de connexion                                   | Vie du compte            |
| Prénom ou pseudonyme       | Affichage dans la famille et l'historique                  | Vie du compte            |
| Hash du mot de passe       | Argon2id — jamais le mot de passe                          | Vie du compte            |
| Secret TOTP                | Chiffré AES-256-GCM, clé hors base                         | Jusqu'à réinitialisation |
| Codes de secours           | Hachés Argon2id                                            | Jusqu'à régénération     |
| Clés d'accès               | Clé publique uniquement — **jamais** de donnée biométrique | Jusqu'à suppression      |
| Date de dernière connexion | Détection d'accès inhabituel                               | Vie du compte            |

### Compte enfant — volontairement minimal

| Donnée                   | Pourquoi                                           |
| ------------------------ | -------------------------------------------------- |
| Prénom ou pseudonyme     | Affichage dans la famille                          |
| Identifiant de connexion | Se connecter **sans adresse e-mail**               |
| Hash du mot de passe     | Argon2id                                           |
| Avatar                   | **Identifiant** parmi des illustrations embarquées |
| Couleur                  | Préférence d'affichage                             |

**Aucune adresse e-mail n'est demandée à un enfant.** C'est la raison d'être de
l'identifiant de connexion : permettre à un enfant d'avoir un compte sans créer de
boîte mail.

**Aucune photo n'est stockée.** L'avatar est une clé texte (`"fox"`, `"owl"`…) qui
désigne un dessin livré avec l'application. Il n'existe aucune fonction de
téléversement : aucune image d'un mineur ne peut se retrouver sur le serveur.

### Données de fonctionnement

Tâches, occurrences, transactions de points, récompenses, sanctions, notifications,
journal d'audit. Ce sont les données que la famille crée elle-même en utilisant
l'application.

### Données techniques — pseudonymisées

| Donnée            | Traitement                                               |
| ----------------- | -------------------------------------------------------- |
| Adresse IP        | **HMAC-SHA256 tronqué à 32 caractères**, jamais en clair |
| Agent utilisateur | HMAC-SHA256 tronqué, jamais en clair                     |

Le HMAC permet de corréler deux événements — « ces deux tentatives viennent du même
endroit » — sans jamais conserver l'adresse elle-même. Sans la clé
`LOG_PEPPER_KEY`, l'empreinte est inexploitable ; et même avec, retrouver une IP
demanderait de tester l'ensemble de l'espace des adresses.

---

## Ce qui n'est PAS collecté

Ces champs **n'existent pas dans le schéma** :

| Non collecté               | Pourquoi c'est important ici                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| Adresse postale            | Sans objet                                                                                         |
| Établissement scolaire     | Sans objet, et particulièrement sensible pour un mineur                                            |
| Numéro de téléphone        | Sans objet                                                                                         |
| Date de naissance          | L'application ne raisonne pas par tranche d'âge                                                    |
| **Géolocalisation**        | Ne sera jamais collectée. `Permissions-Policy: geolocation=()` le garantit au niveau du navigateur |
| Contacts, messages, appels | FamiliPact n'est pas un outil de surveillance                                                      |
| Historique de navigation   | Idem                                                                                               |
| Usage des applications     | Idem                                                                                               |
| Photo d'un enfant          | Aucun téléversement possible                                                                       |

**Aucun traceur publicitaire. Aucune analytique tierce. Aucune revente de données.**
L'application ne charge aucune ressource externe : la CSP le rend techniquement
impossible.

L'application n'est pas indexable (`robots: noindex`).

---

## Durées de conservation

| Donnée                     | Durée                     | Mécanisme           |
| -------------------------- | ------------------------- | ------------------- |
| Compte et famille          | Jusqu'à suppression       | Suppression réelle  |
| Ledger de points           | Vie de la famille         | Append-only         |
| Journal d'audit            | Vie de la famille         | Append-only         |
| Sessions expirées          | 30 jours après révocation | Job `purge-expired` |
| Défis WebAuthn             | 5 minutes                 | Job `purge-expired` |
| Compteurs de rate limiting | Fin de fenêtre            | Job `purge-expired` |
| Occurrences de tâches      | Vie de la famille         | Historique métier   |

Le ledger et l'audit sont conservés tant que la famille existe : c'est ce qui permet de
retrouver **qui** a pris une décision et **pourquoi**. Les purger reviendrait à effacer
l'historique que le produit promet de tenir.

---

## Droits des personnes

### Effacement d'un enfant

Un parent disposant de `CHILD_MANAGE` peut supprimer un profil enfant.

**C'est une suppression réelle, pas un masquage.** Sont effacés en cascade : le compte,
l'adhésion, le profil, toutes les tâches, occurrences, transactions, récompenses,
sanctions et notifications de cet enfant.

Ne subsistent que les entrées d'audit, qui ne portent que le prénom déjà connu de toute
la famille. C'est le minimum nécessaire pour que l'historique des décisions parentales
reste cohérent.

L'action est protégée par la saisie du prénom : elle ne peut pas résulter d'un clic
réflexe.

### Effacement d'une famille

Le propriétaire, après réauthentification et saisie du nom de la famille, peut supprimer
l'ensemble.

Sont effacés : la famille, toutes les adhésions, tous les **comptes enfants** — qui
n'existent que dans cette famille — et toutes les données métier.

Les comptes **adultes** subsistent : ils peuvent appartenir à une autre famille. Leurs
sessions sont révoquées immédiatement.

### Comment l'effacement contourne l'append-only

Le ledger et l'audit sont protégés par un trigger PostgreSQL qui rejette `DELETE`. Une
seule exception, explicite :

```ts
await tx.$executeRawUnsafe(`SET LOCAL familipact.purge = 'on'`);
await tx.family.delete({ where: { id: actor.familyId } });
```

`SET LOCAL` limite le drapeau à la transaction courante : il retombe au `COMMIT`. La
protection ne peut pas rester levée par inadvertance.

### Accès et portabilité

Chaque enfant voit son propre historique de points dans son espace. Chaque parent voit
l'historique familial complet et, avec `AUDIT_VIEW`, le journal d'audit.

**Limite connue :** aucun export machine (JSON, CSV) n'est fourni en V1. Les données
sont consultables mais pas téléchargeables. C'est un manque documenté, à combler pour
une portabilité RGPD complète.

---

## Compatibilité RGPD

| Exigence                               | Mise en œuvre                                                       |
| -------------------------------------- | ------------------------------------------------------------------- |
| Minimisation (art. 5)                  | Champs sensibles absents du schéma                                  |
| Limitation des finalités (art. 5)      | Aucune donnée collectée hors du fonctionnement                      |
| Exactitude (art. 5)                    | Profils modifiables ; corrections de points traçables               |
| Limitation de conservation (art. 5)    | Purge automatique des données techniques                            |
| Intégrité et confidentialité (art. 5)  | Voir [security.md](security.md)                                     |
| Droit d'accès (art. 15)                | Consultation dans l'application                                     |
| Droit de rectification (art. 16)       | Profils modifiables                                                 |
| Droit à l'effacement (art. 17)         | Suppression réelle, enfant ou famille                               |
| Portabilité (art. 20)                  | **Partielle** — consultation oui, export non                        |
| Protection dès la conception (art. 25) | Champs sensibles jamais créés                                       |
| Protection des mineurs (art. 8)        | Compte enfant créé par un parent, via une invitation à usage unique |

**Un enfant ne peut pas créer de compte seul :** il lui faut un jeton d'invitation
généré par un parent de la famille. Le consentement parental est donc structurel.

---

## Ce que l'application ne fait pas, par conception

FamiliPact **n'est pas** un outil de surveillance.

- Il ne sait pas où se trouve un enfant.
- Il ne sait pas quelles applications il utilise.
- Il ne sait pas ce qu'il consulte.
- Il ne lit ni ses messages, ni ses appels.
- Il ne peut bloquer aucun appareil.

Il sait uniquement ce que la famille y a **volontairement** saisi : des tâches, des
points, des règles convenues ensemble.

C'est une différence de nature, pas de degré. Un outil de surveillance observe ; FamiliPact
enregistre un accord.

---

## Pour un déploiement réel

Ce document décrit le comportement du logiciel. Un déploiement destiné à des familles
réelles demanderait en complément :

- une politique de confidentialité rédigée pour les utilisateurs finaux ;
- un registre des traitements ;
- des accords de sous-traitance avec l'hébergeur et le fournisseur de base ;
- une procédure de notification en cas de violation de données ;
- une revue juridique adaptée à la juridiction visée.

Ces éléments dépendent de l'organisation qui déploie et sortent du périmètre du code.
