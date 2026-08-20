# Holding an engine "in use"

`select` does not mark an engine busy. It **renews** a lease that expires on its own.

`packages/engine-registry/registry.ts` stores `assignedSeen`, a timestamp, and reads an engine
as assigned only while `now - assignedSeen < ENGINE_ASSIGN_TTL_MS`. That is deliberate: the
holder is a browser tab, and a tab can be closed, crash, or be put to sleep. Nothing can be
relied on to say goodbye, so the registry forgets by itself and the holder has to keep saying
"still me".

## The bug this shape exists to prevent

A surface that calls `select` once looks correct. Everything works — the engine goes busy, the
picker shows it, the session drives it. Fifteen seconds later the lease lapses and the engine
reads **FREE in everyone's picker, including the holder's own**, while it is still playing.

Nothing errors. No request fails. The only symptom is somebody else picking an engine that was
already in use, which surfaces far from here as two services fighting over one machine.

Two apps shipped that exact bug independently:

- the médiathèque, where fifteen seconds into auditioning a module its engine went back to free;
- m9, whose deck took the lease once and had no `release` in its api client at all — so a deck
  mid-set read as available.

st0' `EngineGate` had renewed from the start. Three copies of one loop, one of which was
missing, is what moved it here.

## What a caller supplies

`holdEngine` takes the two calls rather than making them, because each service reaches **its
own** backend under its own path prefix — `/api` (st0 has none, it answers the origin),
`/pl8/api`, `/m9/api` — and each
holds its own registry (see `packages/engine-registry/docs/shared.md`). The loop is the shared
part; the address is not.

`release` is typed as returning nothing and is called fire-and-forget. Use `navigator.sendBeacon`
for it, not `fetch`: a fetch issued during `pagehide` is cancelled with the page, which is
precisely the moment the goodbye matters. The beacon still is not a guarantee — that is what the
TTL behind it is for.

It carries the engine's **token**, like `select`. A session says who is asking, not which engine
they hold: with an id alone, any logged-in user could drop anyone else's lease on any engine,
and the holder would read FREE in every picker while still driving it. The refusal is silent and
answers 200 — the caller is a page already leaving, so there is nobody left to read a status, and
an unreleased lease simply expires, which is the behaviour it was built for.

## Une expiration se rattrape, un vol non

Les trois refus de renouvellement (`packages/engine-registry/docs/claim.md`) ne se valent pas,
et la boucle n'en signale plus que deux.

- `project` et `engine` — **quelqu'un** a pris le projet, ou la machine. Terminal : `onLost`
  part, l'intervalle s'arrête, la surface cesse de piloter et le dit. Réessayer, ici, c'est
  reprendre le projet des mains d'une personne qui travaille dessus, et cinq secondes plus tard
  elle le reprend des nôtres.
- `lapsed` — **personne** n'a rien pris. Le serveur ne répond ça que quand rien ne détient ce
  projet *et* que rien d'autre ne détient ce moteur : le secret a simplement vieilli, le temps
  d'une mise en veille ou d'une coupure. La boucle oublie le secret mort et le tick suivant
  rouvre — un `select` sans secret, toujours accordé, qui ne prend rien à personne.

C'était un écran mort auparavant : « cet onglet a lâché le projet », un bouton vers l'accueil,
et à l'utilisateur de rouvrir à la main ce qu'il n'avait jamais fermé. Or la socket, elle, se
reconnecte toute seule depuis toujours (`reliability.md`) et redéclare sa session ; seule la
revendication restait par terre. Sortir de veille rend maintenant la main tout seul.

**Le tick suivant, pas tout de suite.** Un moteur qui a quitté le registre répond `lapsed` lui
aussi : rouvrir dans la foulée du 409 tournerait aussi vite que le réseau le permet. Attendre
`ENGINE_ASSIGN_RENEW_MS` borne la reprise à cinq secondes et le martèlement à rien du tout.

Il reste une course d'un aller-retour : entre le 409 et notre réouverture, quelqu'un peut ouvrir
le projet, et une ouverture gagne toujours. C'est la même fenêtre que celle d'un rechargement de
page, et elle vaut mieux que l'écran mort qu'elle remplace.

## The StrictMode detail

`renew()` runs immediately rather than waiting for the first interval tick. React's StrictMode
mounts, unmounts and remounts in dev; the unmount runs the cleanup, which releases. Without the
immediate re-claim the engine would sit released until the first interval fired.
