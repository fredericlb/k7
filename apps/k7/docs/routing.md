# Les chemins de k7 : le préfixe `/k7`, et ce qui n'en a pas

k7 est servi **sous un préfixe**, dans une origine qu'il partage avec st0, pl8 et z0. Presque
tout ce qu'il appelle porte donc `/k7` devant — et les trois exceptions sont la raison d'être
de cette page, parce qu'elles se ressemblent assez pour qu'on les confonde.

## Une seule origine, donc des chemins relatifs

Le SPA est servi à `/k7` et son backend à `/k7/api`, sur le même hôte : nginx le route dans
l'image, Vite le route en dev. Il n'y a donc **aucune origine d'API à configurer**, et tous
les chemins restent relatifs.

`BASE` (dans `apps/k7/frontend/src/api.ts`) est le `base` de Vite, dont la barre oblique
finale est retirée pour que chaque chemin plus bas puisse commencer par la sienne. Il est
**dérivé** au lieu d'être réécrit : le préfixe est déclaré dans
`apps/k7/frontend/vite.config.ts` et nulle part ailleurs.

Toutes les requêtes emportent le cookie de session — `createApiClient` met
`credentials: "include"` par défaut.

## L'API est sous le préfixe ; `/auth` ne l'est pas

L'origine est une, et **st0 possède `/auth/*` à sa racine** pour tous les services. Les appels
d'authentification passent donc par un `fetch` nu plutôt que par le client d'API.

`loginUrl` est un **getter**, pas une constante : il doit capturer l'endroit où l'on se trouve
au moment du clic. Le paramètre s'appelle `return_to`, qui est le nom que lit le paquet OIDC —
un `redirect` serait ignoré. Sans lui, la connexion retombe sur `APP_ROOT`, c'est-à-dire la
racine de l'origine, qui n'est pas k7 : se connecter à k7 dépose l'utilisateur ailleurs.

De la même façon, se déconnecter renvoie sur `/` plutôt que de rester ici : la session est
celle de toute l'origine, et un k7 anonyme rebondirait aussitôt dans l'écran de connexion — ce
qui rendrait la déconnexion impossible.

## Le routeur reçoit un `basename`

`apps/k7/frontend/src/main.tsx` passe `BASE_URL` en `basename`, comme st0 et pl8. Sans lui,
chaque `navigate()` écrit un `/sessions` nu, qui n'appartient pas à k7 : l'application
fonctionne jusqu'au premier rechargement, et celui-ci atterrit hors d'elle.

Avec lui, `useLocation()` rapporte des chemins **sans** le préfixe — c'est ce qui permet à
`navForPath` et à la table de routes de rester écrites comme si k7 possédait l'origine.

## Les URL données au navigateur doivent épeler `BASE`

Les helpers `…Url` d'`api.ts` sont l'exception à la fonction `f()` : ils sont remis à un
`<audio src>`, un `<img src>` ou un lien de téléchargement, donc **c'est le navigateur qui va
chercher**, et plus rien n'est là pour préfixer le service. Chacun d'eux écrit donc `BASE` en
toutes lettres. Un `/api/…` nu n'est pas celui de k7, et le média répond 404.

## La socket de signalisation porte le préfixe elle aussi

`apps/k7/frontend/src/rtc.ts` ouvre sa socket sur le même hôte que le backend, avec le préfixe
de service comme n'importe quel autre appel. L'edge ne route que `/k7/rtc*` jusqu'ici et
**retire le préfixe avant le serveur** — c'est pour cela que le gestionnaire de
`apps/k7/backend/src/rtc.ts` continue de reconnaître un `/rtc` nu.
