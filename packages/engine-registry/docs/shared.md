# Why every service holds its own registry

An engine heartbeats to a **list** of registries, and each hosted service keeps its own
in-memory copy. That is deliberate; the two obvious alternatives are both worse.

## The problem it solves

The registry answers one question: *which engines can this browser reach?* Until now only
l8 asked it, so it lived in l8' backend. Then st0's module preview and m9's
deck started driving engines too — and both had the question hardcoded to `127.0.0.1:8765`
(`probeLocalEngine`), because there was no registry of theirs to consult.

Hardcoding loopback was defensible while a preview *had* to play on the machine the module
lives on. It stops being defensible the moment the user is asked to **choose** an engine per
service, which is the point of this whole line of work.

## Why not one central registry the others query

Because then l8-backend is a dependency of st0-backend, at request time, for the
list a user sees on first load. A l8 deploy would take st0's engine picker down with
it, and the two are deployed separately on purpose. The registry is 120 lines of `Map` — the
coupling would cost far more than the duplication.

## Why not one registry per *machine*

The registry is consulted by a **browser**, over the public internet, before it knows any
engine. It has to live where the browser already is: same origin, behind the same session.

## What this costs

The engine sends N heartbeats every 5 s instead of one. Each is a small POST with a 1500 ms
bound and no retry, and a registry that is down is simply absent from that service's picker
— which is exactly right, because that service genuinely cannot be driven right now.

An engine is therefore listed in several services at once, and **that is the intended
state**: one machine, one audio interface, several apps driving it through separate sessions
(`packages/engine-protocol/docs/sessions.md`).

## Un registre par service, mais un seul montage

Chaque service tient son registre ; aucun n'a de raison de tenir son propre **montage**.
`mountEngineRegistry(app, { service, requireAuth })` pose la garde, le registre et les routes,
et rend un `serve(server, url)` qui attache le relais après `listen` — le relais a besoin de
l'`http.Server`, qu'Express n'a pas avant.

L'ordre est la partie porteuse, et c'est pourquoi c'est une fonction plutôt qu'un paragraphe :
`requireAuth` va sur les chemins destinés au NAVIGATEUR **avant** le routeur, pour que ceux
destinés au MOTEUR — `heartbeat`, `deregister`, où une machine s'authentifie avec son propre
jeton — restent ouverts. Écrit à la main par service, cet ordre était une règle que trois
fichiers devaient tenir ; le jour où l'un d'eux a monté une garde sur tout `/api`, la seule
chose qui protégeait encore le heartbeat était que le routeur avait déjà répondu.

Trois dérives avaient déjà eu lieu, que le socle supprime par construction :

- **La limite de corps.** Le relais fait de ces backends un tuyau vers un quatrième service,
  qui accepte 8 Mo. l8 l'avait relevée, st0 et m9 non : la même requête passait ou faisait 413
  selon l'origine depuis laquelle le navigateur l'envoyait. C'est maintenant
  `ENGINE_BODY_LIMIT`, un seul nombre.
- **Le gestionnaire d'erreur.** Un corps qui cesse d'arriver lève **dans** le parseur, là où
  aucun `try/catch` de route ne le voit. Seul st0 en avait un ; les trois relaient les mêmes
  octets. C'est `engineErrorHandler`, à monter en DERNIER.
- **Le départ.** Un service qui laisse son fichier d'annonce derrière lui est battu vers un
  port mort pour toujours. Le socle installe SIGINT et SIGTERM, et `alsoOnStop` est là pour ce
  qu'un service a en propre — l8 y met son fichier legacy, parce que le socle sort du processus
  dans ses gestionnaires et qu'un second, enregistré après, ne s'exécuterait jamais.

## What `assigned` means now, and why it is nearly obsolete

`assigned` is a lease: a tab re-POSTs `/engine/select` every few seconds, and the flag
expires on its own because a closing tab can only say goodbye best-effort. It exists to hide
an engine already being driven, from a world where a second driver would have destroyed the
first one's project.

Sessions removed that danger — two apps on one engine now hold two projects. The flag
survives as **information** ("someone is on this"), and per-service registries mean it no
longer even spans services: l8' registry knows nothing about the st0 tab holding the
same engine. Retiring it is its own decision, not a side effect of this move.
