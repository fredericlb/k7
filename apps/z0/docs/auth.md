# Qui a le droit d'entrer, et par quelle porte

z0 a **sa** connexion pour une moitié seulement : un joueur de blindtest est un **invité sans
compte**, une espèce que la session studio ne modélise pas, et ce cookie-là est le sien.
L'autre moitié ne lui appartient pas : **le login d'un compte appartient à st0**, et pas par
goût de l'uniformité.

## Pourquoi un service sous un chemin ne peut pas tenir son flux

`redirectUriFor` construit `<origine><X-Forwarded-Prefix>/auth/callback`. Un z0 qui poserait
`X-Forwarded-Prefix: /z0` nommerait donc `https://st0.priv.frediver.se/z0/auth/callback` au
lieu de la racine.

Le client OAuth n'a qu'**une** redirect_uri enregistrée, celle sans préfixe. Demandez l'autre
et l'IdP refuse avant d'afficher quoi que ce soit :

```
error_hint=The 'redirect_uri' parameter does not match any of the
           OAuth 2.0 Client's pre-registered 'redirect_uris'
```

Toute connexion à un compte mourrait alors à l'`authorization endpoint` — l'éditeur, mais
aussi le presenter, le monitor et la remote, qui empruntent tous le même bouton. Le contrôle
qui le prouve : la même requête avec `https://st0.priv.frediver.se/auth/callback` passe la
validation et échoue plus loin, sur la longueur du `state`.

La règle est structurelle : **un service monté sous un chemin ne peut pas tenir son propre
flux sur ce client**. Seul celui qui n'a pas de préfixe le peut, et c'est st0. C'est
exactement la raison pour laquelle pl8 et k7 ne montent aucune route d'auth non plus, et
z0 ne pose pas d'en-tête `X-Forwarded-Prefix`.

## Ce qui entre sur le backend

Deux cookies arrivent, et **un seul est de nous** :

| cookie | signé par | ce qu'il porte |
|---|---|---|
| `bt_session` | z0, `SESSION_SECRET` | les invités : `guest` (mot de passe de session, sur le buzzer) et `guest_online` |
| `studio.sid` | st0, avec la même clé | le compte studio : celui de st0, de la médiathèque et de k7 |

`currentUser()` est le seul point de passage — le middleware, le gate admin et chaque
route en dépendent — et il lit le compte d'abord, l'invité ensuite. **L'ordre est
porteur** : `/auth/logout` ne sait expirer que le cookie de z0, donc un vieux cookie
d'invité qui masquerait un compte serait indéconnectable depuis ici.

L'upgrade WebSocket refait la même lecture à la main (`ws.ts`) : un `upgrade` est un
événement http brut, cookie-session n'y tourne jamais.

## Un seul secret, celui de `common`

Deux cookies, **une** clé — et c'est la même que celle de st0, pl8 et k7. z0 ne déclare pas de
`SESSION_SECRET` à lui. Une clé qui n'est pas celle de `common` ne produit aucune erreur : le
cookie ne se vérifie simplement jamais.

L'objection naturelle, et elle mérite une réponse précise : avec une seule clé, un invité
tient un cookie que ce backend a signé lui-même — ne peut-il pas le renommer `studio.sid`
et devenir un compte, ici et dans toute la médiathèque ?

**Non.** cookie-session signe `<nom>=<valeur>`, donc le *nom du cookie est à l'intérieur de
la signature*. Un `bt_session` présenté sous le nom `studio.sid` porte une signature
calculée sur `bt_session=…`, qui ne vérifie plus. Le nom fait office de séparation de
domaine, et il faudrait la clé pour resigner. `backend/src/auth/session.test.ts` le
verrouille : « rejette un cookie invité renommé studio.sid, même clé comprise ».

### La boucle, et pourquoi c'est la SPA qui la détecte

Une clé qui ne correspond pas produit une panne **muette et circulaire** : `/auth/me`
répond 401, la gate s'affiche, le bouton part chez st0 — qui vous connaît déjà et vous
renvoie aussitôt — et la gate revient, identique. Le compte *est* connecté ; z0 ne sait
simplement pas le lire.

Le backend ne peut pas le diagnostiquer : une mauvaise clé et un visiteur sans cookie
échouent exactement pareil, `sessionFromCookieHeader` renvoyant `null` dans les deux cas.
C'est donc la SPA qui se souvient d'avoir demandé — un jeton dans `sessionStorage` posé par
`login()` — et qui, si elle revient toujours anonyme, affiche la raison au lieu de
reproposer le bouton. Le buzzer est volontairement épargné : sa porte est un formulaire
d'invité, et un invité n'a pas de compte.

## Le scope `groups`, qui passe facilement inaperçu

L'autorisation de z0 lit `groups` (`AUTH_ADMIN_GROUPS`). Le paquet partagé, laissé à
lui-même, demande `openid profile email` : sans `groups`, chaque session porte un
`groups: []` et l'éditeur, le presenter, le monitor et la remote répondent 403 sans rien qui
l'explique.

`apps/st0/backend/src/server.ts` passe donc `scopes` depuis `OIDC_SCOPES`, qui vaut
`openid profile email groups` dans `common`. Une session qui ne porte pas `groups` se corrige
en se reconnectant une fois.

## Se déconnecter

Le bouton ferme ce que le principal tient vraiment, et lui seul :

- un invité → `POST /z0/api/auth/logout`, qui expire `bt_session` ;
- un compte → cela **plus** `POST /auth/logout` sur la racine, car z0 ne signe pas
  `studio.sid` et ne peut pas l'expirer.

La règle vit dans `shared/src/account.ts`, pas en six exemplaires : c'est le genre de
subtilité qui diverge silencieusement dans la cinquième copie.

## À vérifier dans un navigateur

- `/z0/editor` → « Se connecter » → on arrive chez l'IdP (pas une page d'erreur), puis on
  revient **sur l'éditeur** et pas ailleurs sur l'origine ;
- le badge affiche le nom du compte, et l'éditeur s'ouvre au lieu de 403 — c'est le test
  de `groups` ;
- le buzzer avec le mot de passe d'une session : toujours invité, aucun compte demandé ;
- se déconnecter depuis le presenter, puis ouvrir la médiathèque → déconnecté là aussi
  (c'est voulu : c'est un seul compte).
