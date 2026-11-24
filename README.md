# Unaite × Deezer — sample app TypeScript

Une base locale pour connecter un compte Deezer, chercher des titres avec Pipe / GraphQL et écouter avec le SDK Web. Backend TypeScript / Node.js, interface HTML/CSS/JavaScript sans framework. Les deux sample apps proposent le même parcours ; choisissez Python **ou** TypeScript, car elles utilisent le même port.

## Démarrer

Prérequis : **Node.js 22.18 ou plus récent**, npm, un client OAuth **Authorization Code `acNN`**, et son callback enregistré exactement sur **http://localhost:3000/callback**. Récupérez vos identifiants dans [Mes accès équipe](https://unaite.deezer.events/redeem) avec le code privé remis par le staff. Vous pouvez télécharger un `.env` prêt à placer à la racine du kit ; ne l’écrasez pas avec `.env.example`. Le compte du portail de documentation est distinct du compte Deezer.

```sh
npm ci
cp .env.example .env
```

Renseignez `DEEZER_CLIENT_ID` et `DEEZER_APP_ID` dans `.env`, puis :

```sh
npm start
```

Ouvrez **http://localhost:3000** (pas `127.0.0.1`). Cliquez sur **Se connecter à Deezer**, connectez votre compte, puis recherchez un artiste ou un titre. Aucun `client_secret` n’est nécessaire. Le serveur lit `.env` au démarrage : redémarrez après toute modification.

Sous Windows PowerShell, utilisez `Copy-Item .env.example .env` à la place de `cp`.

## Activer la lecture SDK

La connexion et la recherche fonctionnent sans installer le SDK privé. Pour la lecture, il faut un compte Premium, l’`app_id` fourni à votre équipe et le jeton **JFrog en lecture seule** remis par le staff. Le SDK n’est inclus ni dans ce dépôt ni dans le ZIP.

Dans votre terminal, définissez `JFROG_TOKEN` sans l’enregistrer dans le code. Exemple bash/zsh avec saisie masquée :

```sh
read -rs JFROG_TOKEN
export JFROG_TOKEN
npm run sdk:install
unset JFROG_TOKEN
```

Sous PowerShell :

```powershell
$secret = Read-Host 'JFrog token' -AsSecureString
$env:JFROG_TOKEN = [System.Net.NetworkCredential]::new('', $secret).Password
npm run sdk:install
Remove-Item Env:JFROG_TOKEN
```

Le script installe `@deezer/sdk-player@8.8.6` et `@deezer/sdk-auth@3.0.2` depuis le registre officiel privé. Il crée une configuration npm temporaire contenant une référence à la variable, puis la supprime. Aucun paquet Deezer n’est ajouté au lockfile public. `sdk-auth` est disponible pour vos extensions ; cet exemple implémente PKCE directement côté serveur.

Rechargez la page après installation. Cherchez un titre, cliquez sur **Choisir**, puis **Lire / reprendre**. La lecture commence après votre clic ; les droits du compte, du titre et du territoire s’appliquent. Les publicités ne sont pas prises en charge par cet exemple Premium.

## Comprendre le code

- `src/app.ts` : routes HTTP, sessions en mémoire, PKCE, échange/renouvellement des jetons, relais Pipe.
- `src/server.ts` : serveur lié à `127.0.0.1:3000` ; aucun accès réseau public.
- `public/app.js` : recherche, initialisation du Player et commandes de lecture.
- `public/index.html`, `public/styles.css` : interface à modifier pour votre projet.
- `tests/app.test.ts` : tests HTTP contre un transport Deezer simulé, sans compte ni jeton réel.

`POST /login` demande `scope=all` avec PKCE S256. Le callback vérifie un état à usage unique lié au navigateur. Les tokens restent dans une session serveur avec cookie HttpOnly. Le backend renouvelle l’accès avant expiration et conserve les refresh tokens hors du navigateur. Le SDK reçoit l’access token et les licences uniquement en mémoire ; ne les affichez pas, ne les loguez pas et ne les stockez pas dans localStorage.

Les appels passent par `POST /api/pipe` sur la même origine pour éviter les blocages CORS. Les destinations externes sont fixes. Le petit adaptateur `fetch` du frontend redirige l’URL Pipe exacte appelée par le SDK. Les MP3 signés du CDN `cdnt-stream.dzcdn.net` passent aussi par `POST /api/media`, car ce CDN ne fournit pas toujours les en-têtes CORS pour localhost. Une erreur GraphQL peut arriver avec HTTP 200 : vérifiez aussi `errors`.

## Vérifier votre installation

```sh
npm test
npm run typecheck
```

Puis dans le navigateur : connexion → recherche → titre complet → pause/reprise → **Renouveler la session** → nouvelle lecture → déconnexion. Refaire le parcours sur le réseau de l’événement. Les tests automatisés utilisent un faux transport et ne prouvent pas la disponibilité de votre compte ou du réseau Deezer.

## Dépannage

| Symptôme | Action |
|---|---|
| Port occupé | Arrêtez l’autre sample app ou tout service sur 3000 ; ne changez pas le callback sans le faire enregistrer. |
| `forbidden` | Utilisez `http://localhost:3000`, pas une IP, un tunnel ou un domaine tiers. |
| Callback invalide | Recommencez la connexion depuis l’application ; évitez plusieurs onglets de connexion simultanés. |
| `npm E401` | Vérifiez le jeton JFrog complet, son expiration et ses droits `web-sdk`. |
| `scope` / Pipe refusé | Utilisez le client `acNN`, `scope=all`, puis reconnectez-vous. |
| Pas de lecture | Vérifiez SDK installé, `DEEZER_APP_ID`, Premium et disponibilité du titre. |
| Après `npm ci`, SDK absent | Relancez `npm run sdk:install` : `npm ci` nettoie les paquets optionnels non inscrits au lockfile. |

## Limites et publication

Sample **local uniquement**, sessions en mémoire perdues au redémarrage. La déconnexion ferme la session de cette application ; elle ne déconnecte pas nécessairement votre session SSO Deezer. Pour héberger votre projet, il faut adapter HTTPS/cookies Secure, stockage de sessions, contrôle d’accès, limites de trafic et callback enregistré. Ne publiez jamais `.env`, le jeton npm, les cookies ou des captures contenant des tokens.

Le code d’exemple est sous licence MIT. Les SDK et services Deezer restent soumis à leurs propres conditions et droits d’accès. Ce dépôt ne redistribue pas le SDK.

### Relais audio local

Le relais audio exige une session connectée et le jeton CSRF. Il accepte uniquement les URL HTTPS signées de fichiers MP3 sous `cdnt-stream.dzcdn.net/media/`, conserve les plages `Range`, refuse les redirections et ne transmet aucun cookie ni jeton OAuth au CDN. Chaque réponse est limitée à 32 Mio et le délai réseau à 30 secondes. Les URL signées restent en mémoire ; ne les journalisez pas.

## GraphQL Playground

Après la connexion dans la sample app, ouvrez [localhost:3000/playground](http://localhost:3000/playground). L’éditeur utilise la même session OAuth et le relais local : aucun jeton à copier. Choisissez un exemple (profil, artistes, permissions ou introspection), modifiez la requête et ses variables JSON, puis cliquez sur **Exécuter**. La réponse complète affiche aussi les erreurs GraphQL et le statut HTTP. Une seule opération est prise en charge par requête. L’introspection peut être refusée selon les droits de l’API.

Aucun historique ni résultat n’est enregistré. Les mutations peuvent modifier le compte connecté. Le code public ne contient aucun accès d’équipe. Tests de l’éditeur : `npm run test:playground` (Node 22.18+).
