# Authentification

---

## Politique en une page

|                       | Compte **parent** (ADULT)            | Compte **enfant** (CHILD)                 |
| --------------------- | ------------------------------------ | ----------------------------------------- |
| Identifiant           | Adresse e-mail                       | Identifiant de connexion, **sans e-mail** |
| Mot de passe          | 12 caractères minimum                | 8 caractères minimum                      |
| TOTP                  | **Obligatoire et bloquant**          | Non requis                                |
| Codes de secours      | 10, à usage unique                   | Non                                       |
| Clé d'accès (passkey) | Facultative                          | Facultative                               |
| Réauthentification    | Exigée pour les opérations sensibles | Sans objet                                |

**Les cinq règles qui définissent la politique :**

1. Un compte parent **doit** avoir un TOTP confirmé.
2. Une connexion par mot de passe déclenche **toujours** le contrôle TOTP.
3. Une clé d'accès vaut authentification forte et ouvre une session complète, mais ne
   remplace **jamais** le TOTP en base.
4. Les opérations sensibles exigent une vérification **récente** (10 minutes).
5. Un parent ne peut pas désactiver sa protection **et** conserver ses privilèges.

---

## Pourquoi le TOTP est bloquant

Le cahier des charges demande qu'un compte parent « n'accède pas normalement aux
données familiales tant que son MFA n'est pas correctement configuré ». Ce n'est pas
une invitation affichée : c'est un **état de session**.

```
SessionStatus
├── PENDING_MFA_ENROLLMENT   mot de passe vérifié, TOTP pas encore configuré
│                            → accès UNIQUEMENT à l'écran d'enrôlement
├── PENDING_MFA              mot de passe vérifié, TOTP configuré, code attendu
│                            → accès UNIQUEMENT à l'écran de vérification
└── ACTIVE                   authentification complète
```

`requireActiveSession()` refuse les deux premiers statuts. `requireFamilyActor()`
ajoute une seconde vérification : un compte adulte `ACTIVE` **doit** posséder un TOTP
confirmé. Si le TOTP disparaissait — incident, migration ratée — l'accès serait coupé
plutôt que dégradé silencieusement.

---

## Parcours

### Création d'un compte parent et de sa famille

```
1. Saisie : prénom, e-mail, mot de passe, nom de famille, fuseau horaire
2. Création du compte, de la famille et de l'adhésion OWNER  (une transaction)
3. Session ouverte en PENDING_MFA_ENROLLMENT
4. → redirection immédiate vers /securite/configuration
```

L'écran d'inscription annonce dès le départ que la double authentification sera
obligatoire : aucune mauvaise surprise.

### Enrôlement TOTP

```
1. Le serveur génère un secret de 160 bits (RFC 4226)
2. Il le stocke CHIFFRÉ et NON CONFIRMÉ
3. Il rend l'URI otpauth:// et un QR code SVG rendu en ligne
4. L'utilisateur scanne, puis saisit un code à 6 chiffres
5. Le serveur vérifie ; en cas de succès :
   ├── confirmedAt est posé
   ├── 10 codes de secours sont générés et affichés UNE SEULE fois
   └── la session est promue ACTIVE, avec un NOUVEAU jeton
```

Le secret reste inutilisable tant que le code n'est pas validé : afficher un QR code
ne protège rien tant que l'utilisateur n'a pas prouvé l'avoir enregistré.

**Paramètres TOTP** — SHA-1, 6 chiffres, période 30 s, tolérance ±1 pas.

Ces valeurs sont volontairement les plus standard possibles : ce sont les seules
universellement acceptées par Google Authenticator, Microsoft Authenticator, Duo
Mobile et les gestionnaires de mots de passe. Choisir SHA-256 rendrait le QR code
inexploitable par une partie des applications, pour un gain de sécurité nul à cette
échelle — le secret fait déjà 160 bits.

**Protection au repos.** Le secret est chiffré en AES-256-GCM avec la clé
`TOTP_ENCRYPTION_KEY`, qui ne réside jamais en base. L'identifiant de l'utilisateur
sert de donnée associée : un secret déplacé vers un autre compte devient inutilisable.

**Anti-rejeu.** `lastUsedTimeStep` mémorise le dernier pas de temps consommé. Un code
intercepté ne peut pas être rejoué pendant sa fenêtre de validité de 30 secondes.

### Connexion

```
Identifiant + mot de passe
    ├── rate limit par identifiant (8 / 15 min) ET par IP (40 / 15 min)
    ├── verrouillage du compte après 10 échecs consécutifs (15 min)
    ├── compte inexistant → travail de hachage FACTICE, puis même message
    └── succès :
         ├── enfant           → session ACTIVE
         ├── adulte sans TOTP → PENDING_MFA_ENROLLMENT
         └── adulte avec TOTP → PENDING_MFA
```

**Contre l'énumération de comptes.** Un identifiant inconnu déclenche
`consumeDummyPasswordWork()` : une vérification Argon2id sur un hash factice. Sans
cela, une réponse instantanée révélerait qu'une adresse n'existe pas. Le message
d'erreur et le code sont strictement identiques dans les deux cas — vérifié par test.

### Codes de secours

Dix codes de 10 caractères Crockford (~51 bits chacun), hachés en **Argon2id** — comme
des mots de passe, pas comme des jetons — et à usage unique.

La consommation passe par un `updateMany` conditionné à `usedAt IS NULL` : deux
requêtes concurrentes ne peuvent pas consommer le même code.

La recherche du code correspondant teste **tous** les candidats sans court-circuit :
le temps de réponse ne révèle pas la position du code dans la liste.

Régénérer les codes invalide immédiatement les anciens et exige une réauthentification.

---

## Clés d'accès (passkeys)

### Ce qui est réellement implémenté

WebAuthn, avec `authenticatorAttachment: 'platform'` et
`userVerification: 'required'`. C'est **le navigateur** qui déclenche Face ID, Touch ID,
Windows Hello ou la biométrie Android.

**Aucune API biométrique propriétaire n'est appelée.** L'application ne reçoit qu'une
signature cryptographique ; elle ne voit jamais une empreinte ni un visage.

### La passkey ne contourne pas la MFA

C'est le point le plus délicat de la politique, et il mérite d'être explicite.

| Action                        | Effet sur la politique MFA                                           |
| ----------------------------- | -------------------------------------------------------------------- |
| Enregistrer une passkey       | **Aucun.** Exige une session déjà `ACTIVE`, donc un TOTP déjà validé |
| Se connecter par passkey      | Ouvre une session `ACTIVE` **élevée**                                |
| Se connecter par mot de passe | Exige **toujours** le TOTP, passkey enregistrée ou non               |
| Supprimer une passkey         | Ne touche jamais au TOTP                                             |
| Réinitialiser le TOTP         | Coupe l'accès jusqu'à une nouvelle configuration                     |

**Pourquoi une passkey ouvre directement une session complète.** Elle prouve deux
choses simultanément : la possession d'un appareil enrôlé (le facteur « ce que je
possède ») et la présence vérifiée de l'utilisateur (`userVerification: 'required'`,
le facteur « ce que je suis »). Exiger en plus un TOTP reviendrait à demander deux
fois le même facteur.

Aucun mot de passe n'a été présenté dans ce parcours : la règle « une connexion par mot
de passe déclenche le contrôle TOTP » n'est donc pas contournée — elle ne s'applique pas.

### Défis stockés côté serveur

Les défis WebAuthn vivent en base (`WebAuthnChallenge`), avec expiration à 5 minutes et
consommation atomique. L'application peut tourner sur plusieurs instances, et un défi ne
doit jamais être rejouable.

**Compteur de signature.** Une régression stricte sur un compteur déjà non nul trahit
un clonage d'authentificateur et fait échouer la vérification. Les authentificateurs de
plateforme renvoient souvent 0 : ce cas n'est donc pas traité comme une régression.

---

## Réauthentification (step-up)

Certaines opérations exigent une vérification **récente**, dans une fenêtre de
**10 minutes** (`Session.elevatedUntil`).

**Opérations concernées :**

- ajouter un parent (invitation `PARENT` ou `ADMIN`) ;
- modifier les permissions d'un parent ;
- transférer la propriété de la famille ;
- régénérer les codes de secours ;
- modifier ou réinitialiser la MFA ;
- supprimer une clé d'accès ;
- supprimer la famille.

Ces opérations sont déclarées dans `SENSITIVE_CAPABILITIES` (`src/domain/permissions.ts`)
et vérifiées par `requireCapability()`. La liste est **centralisée** : impossible
d'oublier la vérification en ajoutant une route.

**Deux moyens de se réauthentifier :** un code TOTP, ou une clé d'accès.

**Ce qui n'est PAS sensible.** Valider une tâche, confirmer un retrait, ajuster des
points. Ces gestes sont quotidiens : les protéger par une vérification systématique
rendrait l'application pénible, et une confirmation qu'on voit dix fois par jour n'est
plus lue. Leur protection tient à la permission et à l'audit.

---

## Comptes enfants

### Inscription par invitation

```
1. Un parent habilité crée un code d'invitation CHILD
2. L'enfant ouvre FamiliPact et choisit « Rejoindre une famille »
3. Il saisit le code, ou scanne le QR code
4. Le serveur valide SANS consommer
5. L'enfant choisit prénom, identifiant de connexion et mot de passe
6. Compte créé, adhésion créée, jeton consommé — DANS LA MÊME TRANSACTION
7. Session ACTIVE immédiate
```

Le jeton est consommé dans la même transaction que la création du compte : si la
création échoue, le jeton reste valide.

**Le code ne sert jamais à la connexion quotidienne.** L'enfant se connecte ensuite
avec son identifiant et son mot de passe.

### Identifiant distinct du nom affiché

`User.loginId` (par exemple `lucas.4f2a`) et `User.displayName` (« Lucas ») sont deux
colonnes séparées. Un parent peut renommer un enfant dans l'interface sans casser ses
identifiants de connexion.

Le serveur suggère un identifiant disponible à partir du prénom, avec un suffixe
aléatoire : cela évite les collisions entre familles sans exposer de compteur global.

### Protections

Les comptes enfants bénéficient des **mêmes** protections contre la force brute que les
comptes parents : rate limit par identifiant et par IP, verrouillage temporaire après
10 échecs, message d'erreur indifférencié.

---

## Sessions

| Propriété            | Valeur                               | Raison                                                                                                                          |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Transport            | Cookie `__Host-familipact_session`   | Le préfixe `__Host-` impose `Secure`, `Path=/` et l'absence de `Domain` : un sous-domaine compromis ne peut pas poser le cookie |
| Attributs            | `HttpOnly`, `Secure`, `SameSite=Lax` | Inaccessible au JavaScript, bloque l'envoi inter-site                                                                           |
| Contenu              | Jeton aléatoire de 256 bits          | Le SHA-256 seul est stocké                                                                                                      |
| Expiration glissante | 12 heures                            | Toute activité la repousse                                                                                                      |
| Expiration absolue   | 30 jours                             | Non prolongeable, même en cas d'activité                                                                                        |
| Rotation             | Après validation du second facteur   | Protection contre la fixation de session                                                                                        |
| Révocation           | Immédiate                            | Voir ci-dessous                                                                                                                 |

En développement HTTP, le préfixe `__Host-` serait refusé par le navigateur : le nom
retombe sur `familipact_session`, **uniquement hors production**.

**Révocation immédiate.** C'est la raison pour laquelle les sessions sont en base et
non des JWT. Sont révoquées instantanément :

- toutes les sessions d'un parent retiré de la famille ;
- toutes les sessions après une réinitialisation de MFA ;
- la session précédente après validation du second facteur ;
- la session courante à la déconnexion.

**Journalisation minimisée.** L'adresse IP et l'agent utilisateur ne sont **jamais**
stockés en clair : seul un HMAC-SHA256 tronqué est conservé. Il permet de corréler deux
événements sans conserver la donnée personnelle.

---

## Récupération de compte

| Situation                                     | Solution                                                   |
| --------------------------------------------- | ---------------------------------------------------------- |
| Téléphone perdu, codes de secours disponibles | Connexion par code de secours, puis nouvel enrôlement TOTP |
| Téléphone perdu, clé d'accès enregistrée      | Connexion par clé d'accès                                  |
| Téléphone perdu, aucun des deux               | **Aucune récupération automatique**                        |

Le dernier cas est un choix assumé. Une procédure de récupération par e-mail seul
ramènerait la sécurité du compte à celle de la boîte mail, ce qui viderait la MFA
obligatoire de son sens.

**Atténuation en place :** l'écran de sécurité affiche en permanence le nombre de codes
de secours restants, et propose d'enregistrer une clé d'accès.

**Extension possible en V2 :** une récupération validée par le propriétaire de la
famille — un autre humain de confiance, plutôt qu'un canal technique.

---

## Ce qui n'est pas proposé, et pourquoi

**SMS comme second facteur.** Vulnérable au détournement de carte SIM et à
l'interception SS7. Explicitement écarté par le cahier des charges.

**Questions secrètes.** Réponses devinables ou trouvables sur les réseaux sociaux.

**« Se souvenir de cet appareil » sans MFA.** Reviendrait à rendre la MFA facultative
en pratique. L'expiration glissante de 12 heures offre déjà un confort raisonnable.

**Connexion par lien e-mail (magic link).** Ramènerait la sécurité du compte à celle de
la boîte mail.
