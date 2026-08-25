# Supervisor policy — origins, logs, processes, audio, dev reload

Background for the one-line headers in `engine-host/src`. Each section names its file.

## `supervisor.ts` — the loops, and the pace each one runs at

Nothing here is pushed: the engine has no callback for an interface being unplugged or a song
being loaded, so the supervisor asks. Every poll therefore costs something forever, and the
interval is the whole of the design.

| constant | why that pace |
|---|---|
| `WATCH_MS` (2 s) | both process watches. Fast enough that a crash is noticed before the user is, slow enough to be free — each tick is a pidfile stat or a socket connect. |
| `DEVICES_POLL_MS` (30 s) | this is what notices an interface being plugged in or pulled out — and it is the one poll that TOUCHES A DRIVER, so it was slowed from 2 s. See below. |
| `SESSIONS_POLL_MS` (2 s) | an app connecting or a song loading is a human-speed event, and the submenu redraws only when the signature moves anyway. |
| `EDIT_PLUGINS_POLL_MS` (3 s) | a user swaps songs at human speed, not interface-unplug speed. |
| `PLUGINS_POLL_MS` (60 s) | the plugin scan is expensive and the answer barely moves. Until it lands we ask at `PLUGINS_POLL_FAST_MS` (2 s) instead, to keep the spinner honest — that poll reschedules itself rather than sitting on one interval. |
| `BACKOFF_MAX_S` (30 s) | the relaunch backoff for a crashing engine, doubling from 1 s. One that dies on startup — a bad audio device, a missing DLL — would otherwise be relaunched forever at one per second, and the log would be nothing but that. |
| `DEREGISTER_TIMEOUT_MS` (1.5 s) | a hung registry must not hold the quit open. The tray gives the supervisor about 3 s in total before it kills it. |

### Pourquoi celui des interfaces est le seul à 30 s

Les autres sondages coûtent un `stat`, une connexion de socket ou une lecture d'état. Celui-ci
appelle `scanForDevices()` sur **chaque** type de périphérique, ASIO compris, dans le processus du
moteur, pendant que le callback audio tourne. Mesuré sur la machine de référence : **50 ms par
scan**, six fois sur six. À 2 s, ça fait 1800 contacts avec le pilote par heure, pour une réponse
qui ne change que quand on branche quelque chose.

Le callback n'en souffre pas — mesuré aussi : son maximum pendant une rafale de scans est de
0,278 ms contre 0,356 sans, donc dans le bruit. Ce n'est pas un problème de temps réel. C'est que
**c'est la seule chose que le moteur fasse qui atteigne vraiment le pilote**, et que deux écrans
bleus `KMODE_EXCEPTION_NOT_HANDLED` ont eu lieu dans `FocusriteUsb.sys` avec `studio-moteur` comme
processus courant (`docs/constat.md`). Un pilote ASIO est mono-client ; le sonder sans arrêt
pendant qu'il diffuse est le genre de sollicitation qui réveille une assertion.

**Ce n'est pas prouvé**, et le ralentissement est une expérience plutôt qu'un correctif : à coût
nul, on retire la seule sollicitation répétée qu'on impose au pilote, et on regarde si les
plantages cessent. Si le scan est innocent, on n'aura perdu que de la promptitude.

**Ce que ça coûte, dit franchement.** Brancher l'interface met jusqu'à 30 s à être remarqué, la
bascule vers le repli aussi, et le sous-menu du tray est périmé d'autant. C'est le prix, et il se
paie à chaque branchement.

**Le vrai correctif, si celui-ci tient.** JUCE expose un `AudioIODeviceType::Listener` que Windows
alimente sur arrivée et retrait de matériel. Y passer donnerait les deux à la fois — réaction
immédiate ET zéro scan périodique — mais c'est du travail dans le moteur, et il ne vaut d'être fait
que si le sondage s'avère bien coupable.

### Signatures, not arrays

The tray rebuilds a submenu whenever the snapshot it draws from changes, so what the polls
compare is a **signature** rather than the data.

- The audio menu compares `menuSignature`, so a device list that came back identical redraws
  nothing.
- The edit-plugin signature is built from the OPENABLE ids and is **session-qualified**: the same
  module id in two projects is two rows, and the signature has to change when one of them goes.
- The session signature includes `playing` and `listeners` because those are on the label — they
  are the two facts that answer "who is using my interface right now". The **playhead is not in
  it**, and that is the point of having a signature at all: it moves 20 times a second and would
  put the whole snapshot on the wire with it.

### Bringing the file service up, including the adopted case

`ensureFileService` is called from every start path, and the ADOPT case is why. A force-killed
tray leaves its engine and its pidfile behind but **not** its file service, so a launch that
adopted the orphan and skipped this would come up with no file service at all — the "no answer on
:8770" the web UI shows.

It is handed **all** the registry URLs, comma-joined: the file service builds its CORS allowlist
from them, and every service holding a registry is a browser that will call it. Passing the first
alone would refuse the médiathèque with nothing logged anywhere.

The watch over it, unlike the engine's crash watch, **never relaunches**. A file service that
keeps falling over is something the user should see and act on rather than have papered over, and
the restart is one menu click away. It reports **both ways**, because it is a live reading rather
than a failure record: restart `npm run dev` and the icon should go green again on its own.

### The registries are re-resolved on every heartbeat

The ambient tiers can move under the supervisor. Under `npm run dev` the tray and the backends
start together, so a supervisor that wins the race resolves before any of them has advertised —
and would then announce to the hosted studio forever while three local registries sat empty.

So each tick re-derives the list, unless the user pinned one: an explicit choice must not be
re-derived. It is cheap, a readdir of four small files (`registryClient.ts`).

`resolveRegistryUrls` reads four tiers, most explicit first, and the **first tier that yields
anything wins outright** — they are alternatives, not a union:

1. what the user pinned with "Add web UI…" — a deliberate, persisted choice beats an ambient one,
   which is why it sits above the environment variable;
2. `$STUDIO_REGISTRY_URL`, comma-separated for more than one;
3. what the local backends advertised — `~/.studio/web-endpoints/*.json`, one file per service,
   plus the legacy single `web-endpoint.json` — so a local dev setup beats the hosted default;
4. the hosted studio.

It answers a **list**, because each hosted service holds its own registry and an engine must be
listed in st0 *and* in the médiathèque to be pickable in both. Deduped, since the same URL twice
would mean two heartbeats a tick to one server for nothing. The legacy single file is still read
because an older st0 backend writes only that one and an older tray reads only that one; the
union is what stops a version skew from silently costing an app its engine.

The heartbeat is **all-or-nothing**: the tray shows one light, so "ok" has to mean every service
can offer this engine. A registry that is down is simply absent from that service's picker, which
is correct — that service genuinely cannot be driven right now.

The médiathèque this machine caches is **derived** from those URLs rather than configured: every
service sits on one origin at a fixed path, so only the origin varies, and asking for the
library's URL separately made a second hand-typed copy of a fact already on disk — which is how a
machine ends up heartbeating to one studio and syncing from another. Only the origin is kept and
the path comes back from the service table. The first resolvable registry wins, and an
unparseable one yields nothing rather than an empty string the file service would read as
configured.

`addRegistryUrl` is an **add**, not a replace. Each hosted service holds its own
registry, so "Add web UI…" for the médiathèque must not evict st0 — that would silently take the
engine out of one picker to put it in another, and the two are not alternatives. It is idempotent
beyond re-announcing, and it persists the result as the explicit list so the next boot takes it
rather than the ambient environment variable.

### Shutdown order

Deregister **first**, while the entry still means something, but bounded by
`DEREGISTER_TIMEOUT_MS`. Then tear down — and unlike Stop, this does **not** spare an adopted
engine: one left listening holds the audio device and both ports for whatever launches next.

## `webOrigins.ts` — the web UIs this engine trusts

A st0 web UI reached over a real hostname (`https://daw.test` behind the proxy, a
hosted deployment) is neither loopback nor a private address, so the file service's
deny-by-default CORS policy cannot admit it on its own (see
`packages/file-service/src/cors.ts`). This list is how the user says "that one is mine":
written here, read there, and read on EVERY request, so adding a web UI from the menu
bar takes effect immediately with nothing restarted.

`~/.studio/web-origins.json` — `{"origins": ["https://daw.test"]}` — is part of the
shared `~/.studio` contract, like `engine-id.json` and `web-endpoint.json`.

Only ORIGINS are stored (`scheme://host[:port]`). A browser's `Origin` header is always
bare, so a path or query the user pasted would simply never match; it's stripped at the
door rather than stored as something that silently can't work.

This module lives in engine-host rather than file-service because the SUPERVISOR is the
writer, and the writer defines the format. file-service imports it to read. That
direction stays acyclic: the host spawns the file service by PATH, not by import.

## `logbus.ts` — the merged log

The supervisor spawns both the engine and the file service; rather than two separate
files the user has to cross-reference, their stdout/stderr are piped here and written to
ONE file, each line tagged with its source and a timestamp. That single file is what the
tray's "Show logs" opens and what the file service serves to the web UI's Logs panel.

The line format is `HH:MM:SS [tag] text` and must stay BYTE-IDENTICAL: the Logs panel seeds
on a tail and then polls by byte offset, so a format change is not cosmetic.

**TRUNCATION IS NOT OURS.** We open in APPEND mode, always. The tray truncates the file
once when it starts, because the tray's lifetime is what "a session" means — and this
process can be relaunched mid-session after a crash, at which point truncating would
wipe the log the user is reading to find out why it crashed. The tray also appends its
own `[host]` lines to the same file; single writes in append mode are atomic on both
platforms, so the two writers interleave whole lines rather than tearing.

## `fileServiceProcess.ts` — the spawn rule

The file service serves workspaces and every file operation to the browser (the C++
engine stays file-free). It runs next to the engine and dials it locally, sharing the
engine's identity so its light gate matches.

The spawn rule, which must not be simplified:

1. **Something is already answering the file port → do nothing.** In a dev run that
   something is `npm run dev` (tsx watch on 8770), which owns the service and reloads it
   on edit. Spawning a second one would fight it for the port.
2. **A bundled runtime resolves (a packaged app) → the vendored node runs the bundled
   `.mjs`.**
3. **Neither → FAILED.** That is what the red icon and the "Restart file service" menu
   entry exist for; reporting green here would be a lie the user cannot act on.

Branch 1 is the one that looks droppable and is not: without it the spawn races `npm run dev`
for 8770.

## `engineProcess.ts` — adopting, and what a pidfile is not

A pidfile is what makes a supervisor crash survivable: the engine outlives us, and the next
supervisor ADOPTS it rather than finding the port held by a process nobody owns.

What it is not is an identity. `engineRunning()` asks the operating system whether that NUMBER
is a live process — nothing more — and a pid is reused. Trusting it alone is silent in every
direction: the engine dies, the OS hands its pid to an unrelated `node`, and the next
supervisor reads the pidfile, finds the pid alive, logs *adopting the engine already on the
pidfile* and spawns nothing. The crash watch asks the same question, so it never relaunches
either; the heartbeat asks it too, so every registry goes on being told an engine is there, and
every app lists a machine that answers nothing.

So the port is asked as well: adopt only if something is actually serving on it, and otherwise
treat the pidfile as stale, clear it and start a fresh engine. The dead pid's process is left
alone — it belongs to somebody else now.

**Why here and not in the crash watch.** The same check there would be the complete fix, and it
carries a risk this one does not: a probe that answers wrongly under load would relaunch an
engine that is playing. `start()` runs before anything plays, so a wrong answer costs a spare
engine instead of somebody's audio. Extending it to the crash watch is a real decision — it
needs consecutive failures before acting — and it has not been taken.

## `engineQueries.ts` — request/reply over one connection

The polls run at 30 s / 2 s / 3 s, so a fresh WebSocket per call would be roughly one TCP
handshake per second, forever, each connection then reading and discarding the engine's ~20 Hz
`state` broadcasts until its own typed reply arrived. One connection whose firehose is simply
not listened to costs nothing.

Three things a fresh connection per call would give for free, and that a shared one has to
provide itself:

1. **REQUEST/REPLY.** Every `EngineControl` method is fire-and-forget; the reply comes
   back as an event. Each function pairs a send with a one-shot listener and a per-call
   deadline.
2. **ONE AT A TIME.** `set-audio-device` is answered with an `audio-devices` frame — the
   same type the devices poll waits for. On a shared connection a concurrent poll would
   capture the other request's reply and both would be wrong. Every call goes through
   `queue`, so exactly one is ever in flight.
3. **NO STALE STATE.** A fresh socket each time has none; here a dropped connection has
   to be noticed and redialled (see `connected`).

## `audioPolicy.ts` — which interface the engine should be on

The engine picks *some* device at boot and, when one is pulled out from under it, falls
to whatever the OS offers next. That's not a decision the user made. The policy that
corrects it:

1. the interface the user PICKED, whenever it's present — so replugging it is enough to
   get it back, with no trip to the menu;
2. otherwise the FALLBACK they configured (typically the built-in output);
3. otherwise leave the engine alone — better a device we didn't choose than none.

Kept apart from the loop that calls it so the rules are readable and testable without a
running engine. This is supervisor POLICY (which device this machine should be on), not
a protocol capability — which is why it lives here and not in `@studio/engine-client`.

## `devReload.ts` — restart on source change, in dev only

The mechanism is deliberately not a mechanism: we EXIT, and the tray's existing relaunch
loop (`host.rs run_forever`) starts a fresh one. That path is already built, already
tested, and already correct about the hard part — the engine survives, because it is
tracked by `~/.studio/engine.pid` and the new supervisor adopts it. So a reload costs a
few hundred milliseconds and never touches the audio device.

Two things it must NOT do:

- **Run the shutdown path.** That deregisters and stops the engine — turning a source
  edit into an audio dropout and a registry round-trip. We exit and leave the stack
  standing; adoption picks it back up.
- **Arm in a packaged build.** The watcher is gated on running from TypeScript source
  (`isDevSource`), so a shipped app carries these few lines and never calls them.
