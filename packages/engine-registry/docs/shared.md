# Why every service holds its own registry

An engine heartbeats to a **list** of registries, and each hosted service keeps its own
in-memory copy. That is deliberate; the two obvious alternatives are both worse.

## The problem it solves

The registry answers one question: *which engines can this browser reach?* Every service that
drives an engine asks it — st0 for a song, pl8 for a module preview — so a service without one
has nothing to consult and can only hardcode `127.0.0.1:8765` (`probeLocalEngine`).

Hardcoding loopback is defensible while a preview *has* to play on the machine the module
lives on. It stops being defensible the moment the user is asked to **choose** an engine per
service, which is the point of the whole arrangement.

## Why not one central registry the others query

Because then st0-backend is a dependency of pl8-backend, at request time, for the
list a user sees on first load. A st0 deploy would take pl8's engine picker down with
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
jeton — restent ouverts. Écrit à la main par service, cet ordre serait une règle que chaque
fichier devrait tenir ; qu'un seul monte une garde sur tout `/api` et la seule chose qui
protégerait encore le heartbeat serait que le routeur a déjà répondu.

Trois dérives que le socle supprime par construction :

- **La limite de corps.** Le relais fait de ces backends un tuyau vers le service de fichiers,
  qui accepte 8 Mo. Relevée dans un service et pas dans l'autre, la même requête passe ou fait
  413 selon l'origine depuis laquelle le navigateur l'envoie. C'est `ENGINE_BODY_LIMIT`, un
  seul nombre.
- **Le gestionnaire d'erreur.** Un corps qui cesse d'arriver lève **dans** le parseur, là où
  aucun `try/catch` de route ne le voit, et tous les services relaient les mêmes octets. C'est
  `engineErrorHandler`, à monter en DERNIER.
- **Le départ.** Un service qui laisse son fichier d'annonce derrière lui est battu vers un
  port mort pour toujours. Le socle installe SIGINT et SIGTERM, et `alsoOnStop` est là pour ce
  qu'un service a en propre — st0 y met son fichier legacy, parce que le socle sort du processus
  dans ses gestionnaires et qu'un second, enregistré après, ne s'exécuterait jamais.

## What `assigned` means, and why it is nearly obsolete

`assigned` is a lease: a tab re-POSTs `/engine/select` every few seconds, and the flag
expires on its own because a closing tab can only say goodbye best-effort. It hides an engine
already being driven, from a world where a second driver would destroy the first one's project.

Sessions remove that danger — two apps on one engine hold two projects. The flag survives as
**information** ("someone is on this"), and per-service registries mean it does not even span
services: st0's registry knows nothing about the pl8 tab holding the same engine. Retiring it
is its own decision.
