# Qui a le droit d'entrer, et par quelle porte

z0 a longtemps eu **sa** connexion : son cookie, son flux OIDC, son callback. Ce n'était
pas un caprice — un joueur de blindtest est un **invité sans compte**, une espèce que la
session studio ne modélise pas. Cette moitié-là est toujours vraie. L'autre moitié ne
l'est plus : **le login d'un compte appartient à st0**, et pas par goût de l'uniformité.

## Ce qui a cassé

`redirectUriFor` construit `<origine><X-Forwarded-Prefix>/auth/callback`. Le Caddyfile
posait `X-Forwarded-Prefix: /z0` sur le backend du jeu — là et nulle part ailleurs — pour
que z0 nomme `https://studio.test/z0/auth/callback` au lieu de la racine, qui est à st0.

Sauf que le client OAuth n'a qu'**une** redirect_uri enregistrée, celle sans préfixe.
Demandez l'autre et l'IdP refuse avant d'afficher quoi que ce soit :

```
error_hint=The 'redirect_uri' parameter does not match any of the
           OAuth 2.0 Client's pre-registered 'redirect_uris'
```

Donc toute connexion à un compte mourait à l'`authorization endpoint` — l'éditeur, mais
aussi le presenter, le monitor et la remote, qui empruntent tous ce `/z0/auth/login`.
Le contrôle qui le prouve : la même requête avec `https://studio.test/auth/callback` passe
la validation et échoue plus loin, sur la longueur du `state`.

La leçon est structurelle, pas accidentelle : **un service monté sous un chemin ne peut
pas tenir son propre flux sur ce client**. Seul celui qui n'a pas de préfixe le peut, et
c'est st0. C'est exactement la raison pour laquelle l8, m9 et k7 ne montent aucune route
d'auth non plus.

## Ce qui entre maintenant

Deux cookies arrivent sur le backend, et **un seul est de nous** :

| cookie | signé par | ce qu'il porte |
|---|---|---|
| `bt_session` | z0, `SESSION_SECRET` | les invités : `guest` (mot de passe de session, sur le buzzer) et `guest_online` |
| `studio.sid` | st0, `STUDIO_SESSION_SECRET` | le compte studio, celui de la médiathèque, de l8 et de m9 |

`currentUser()` est le seul point de passage — le middleware, le gate admin et chaque
route en dépendent — et il lit le compte d'abord, l'invité ensuite. **L'ordre est
porteur** : `/auth/logout` ne sait expirer que le cookie de z0, donc un vieux cookie
d'invité qui masquerait un compte serait indéconnectable depuis ici.

L'upgrade WebSocket refait la même lecture à la main (`ws.ts`) : un `upgrade` est un
événement http brut, cookie-session n'y tourne jamais.

## Deux secrets, et pourquoi

La tentation est de faire lire à z0 le `SESSION_SECRET` de `common` et d'en finir. **Non.**
Une valeur de cookie-session est un JSON signé, et la signature ne couvre que
`<nom>=<valeur>` — le *nom* du cookie en fait partie, mais rien n'empêche de resigner.
Avec une seule clé, un invité tiendrait un cookie que ce backend a signé lui-même : il lui
suffirait de le présenter sous le nom `studio.sid` pour devenir un compte — ici, et dans
la médiathèque, l8 et m9, qui font confiance au même cookie.

Donc `SESSION_SECRET` reste à z0 pour ce qu'il **émet**, et `STUDIO_SESSION_SECRET`
(= le `SESSION_SECRET` de `common`) ne sert qu'à **vérifier**. Le test qui verrouille ça
est dans `backend/src/auth/session.test.ts` : « un cookie invité renommé studio.sid est
rejeté ».

Vide, `STUDIO_SESSION_SECRET` laisse tourner une soirée d'invités et avertit au démarrage.
C'est un avertissement et pas une erreur : z0 doit pouvoir démarrer là où st0 n'est pas
déployé — mais toutes les surfaces admin répondent 401 dans cet état.

## Le scope `groups`, qui a failli passer inaperçu

L'autorisation de z0 lit `groups` (`AUTH_ADMIN_GROUPS`). z0 demandait ce scope ; st0 ne le
demandait pas — le paquet partagé se rabat sur `openid profile email`. Adopter la session
de st0 sans rien d'autre aurait donc mis un `groups: []` dans chaque session et fermé
l'éditeur, le presenter, le monitor et la remote par un 403 impossible à expliquer.

`apps/st0/backend/src/server.ts` passe maintenant `scopes` depuis `OIDC_SCOPES`, qui vaut
déjà `openid profile email groups` dans `common`. Conséquence à connaître : **une session
studio ouverte avant ce changement ne porte pas `groups`** — il faut se reconnecter une
fois.

## Se déconnecter

Le bouton ferme ce que le principal tient vraiment, et lui seul :

- un invité → `POST /z0/api/auth/logout`, qui expire `bt_session` ;
- un compte → cela **plus** `POST /auth/logout` sur la racine, car z0 ne signe pas
  `studio.sid` et ne peut pas l'expirer.

La règle vit dans `shared/src/account.ts`, pas en six exemplaires : c'est le genre de
subtilité qui diverge silencieusement dans la cinquième copie.

## À vérifier dans un navigateur

- `/z0/editor` → « Se connecter » → on arrive chez l'IdP (pas une page d'erreur), puis on
  revient **sur l'éditeur** et pas sur la médiathèque ;
- le badge affiche le nom du compte, et l'éditeur s'ouvre au lieu de 403 — c'est le test
  de `groups` ;
- le buzzer avec le mot de passe d'une session : toujours invité, aucun compte demandé ;
- se déconnecter depuis le presenter, puis ouvrir la médiathèque → déconnecté là aussi
  (c'est voulu : c'est un seul compte) ;
- une session studio ouverte **avant** ce changement : se déconnecter/reconnecter une fois,
  sinon `groups` manque.
