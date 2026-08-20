# Sessions inside the engine

One engine holds N projects. `packages/engine-protocol/docs/sessions.md` covers the id and the
client rules; this page is the engine's half — who may create a session, who may only look at
one, what the lock protects, and when a session goes away.

## The registry, and what the lock is on

`engine/moteur/engine/SessionRegistry.h` is a `std::map<std::string, std::unique_ptr<T>>` behind
a mutex. Three things about it are load-bearing:

**The lock protects the MAP's structure, never a session's contents.** `std::map` does not
invalidate references to existing elements on insert, and a `Session` sits behind a
`unique_ptr` — so a reference handed out stays valid however much the map grows around it.
Nothing holds the lock while an Edit is rebuilt; the worst case for any waiter is a map lookup.

**`emplace` creates, `find` does not.** These are two different verbs on purpose, and which one
a call site uses is the whole of the "created by reading" rule below.

**`withSession` exists for threads that are not the message thread.** It runs a lambda with the
`T&` *inside* the lock and returns `false` when there is no such session, so a non-message
thread cannot keep a pointer past the lock. An accessor that handed out a pointer and trusted
the caller to take the lock would be the same bug with more steps.

`find`'s raw pointer *is* used past the lock, and that is safe for a narrower reason: only the
message thread erases, and only the message thread calls `find`.

### The race this replaced

Before the registry, `session(id)` was a bare `sessions[id]` — a `std::map::operator[]`, which
inserts. `drainBroadcast` and `skipBroadcastToLive` went through it **from the sender thread**,
while the message thread did the same on every inbound message and every 50 ms state tick, with
no mutex anywhere.

The comment justifying the lock-free access said the ring "outlives every edit". That was true
of the ring and had stopped being true of the **lookup that finds it**, once the ring moved
inside a map keyed by session. It was reachable rather than theoretical: `main.cpp` records a
new listener's session under `listenersMx` *before* the posted `enableBroadcast` runs, so the
sender thread could be the first to touch a brand-new id.

`tests/SessionRegistry_test.cpp` pins the invariants. Its concurrency case is a **stress test,
not a race detector** — MSVC ships no TSan, so on Windows it proves only "did not tear under
load". The real instrument is the `asan` preset on a platform that has the sanitisers.

## A session is created by a client DRIVING one, never by a reader

The rule, in one sentence: **the inserting `session()` is reachable only from the writes that
mean "this client drives this project"** — `apply` / `applyFull`, `enableBroadcast(on = true)`,
and `setRecordEnabled`. Everything else uses `find()` and has an obvious answer for absence:
the empty doc, `nullptr`, `-100 dB`, an empty vector.

This matters because reading used to create. Every accessor went through the inserting form,
including the `const` ones, so:

- the **supervisor conjured the default session**. It polls `list-edit-plugins` on a timer with
  an `EngineControl` that has no session — so `DEFAULT_SESSION`, the empty string — and the
  first touch created it. It then appeared in the tray's own Sessions submenu, reported by the
  process that had just invented it.
- the state timer re-touched every session it listed, forever.
- there was no "unknown session" path at all, because there was no such thing as an unknown one.

`main.cpp` still reads `session` with no allowlist, deliberately: naming a session is what
creates it, and a whitelist would mean the engine had to be told about every app in advance.
What it does have is a **ceiling** — an id longer than 256 bytes is refused, so a malformed
client cannot grow the map without bound.

### `list-edit-plugins` had to become engine-global

Making reads non-creating would have quietly emptied the tray's "Native plugin UI" submenu:
the supervisor asks on the default session, which after the change holds nothing. It was never
really a per-session question anyway — with N projects there is no *the* loaded edit — so it now
walks every session and stamps each row with the one it came from, exactly like `list-sessions`.

That is also what makes it compose with the stamping rule rather than fight it: stamped
per-session *and* asked on the default session, every reply would be dropped by `forSession` in
the supervisor's own client.

## Which replies carry a session

`packages/engine-protocol/sessions.ts` holds the two lists, `PER_SESSION_REPLIES` and
`ENGINE_GLOBAL_REPLIES`, and `sessions.test.ts` pins them. In `main.cpp` the choice is a **verb**:

| verb | for |
|---|---|
| `broadcast(j)` | the machine's answers — the device list, the installed catalogue, the session list, `whoami` |
| `broadcastTo(sid, j)` | everything about one project |

Two verbs rather than a hand-written `{"session", …}` per reply, because seventeen hand-stamped
literals is precisely how the eighteenth gets forgotten. A new reply has to *choose*, and the
choice is reviewable in one word.

Before this, only `state` and `session-dropped` were stamped, and `forSession` passes a frame
with no session at all. So an pl8 module audition made st0 flash `busy` and clear its warning
badges, and st0 received `applied`, `flushed` and `recorded` for a project it did not own.

**`forSession` was left alone**, and that is deliberate. Pass-on-absence is what keeps a current
client from going deaf against an older engine that stamps nothing; the leak was never in that
rule but in the engine failing to disagree. A capability announced in `whoami` would only help
if the engine *forgot* to stamp something — and would then make the client deaf on that frame
instead of merely unsorted, which is strictly worse and equally silent.

### `engine-warning` and the WarningScope

`studio::warn()` is called from `EditBuilder`, `PluginParams`, `GraphDspPlugin`,
`MidiGraphPlugin` and `AudioDevices` — none of which knows a session, and threading a parameter
through all of them would be a large noisy change for a small field. Instead `WarningScope` is
an RAII object over a `thread_local`, opened at the four entry points that already have a
session and produce essentially every warning: `applyFull`, `apply`, `setPreset`,
`showNativePluginUI`.

A warning raised outside any scope — the audio thread's prepare, startup, a device fault — goes
out unstamped, which is correct: it belongs to no project, and is exactly the case
pass-on-absence covers.

## When a session goes away

Three layers, and only the first two are required.

**1. Stop creating.** After the rule above, a session exists only because somebody sent it a
project or subscribed to its audio.

**2. `drop-session` stays primary.** It is wired end to end — the tray's Sessions row, the
supervisor, `EngineControl.dropSession`, and now `EngineClient.dropSession` in the browser
client, which had no such verb at all. The file service calls it from `unloadEngine`, the one
place that genuinely means "this workspace is done".

**3. A TTL on emptiness, as a backstop.** Swept from the existing state timer rather than a
timer of its own:

> A session is reapable when it **holds nothing** — no `edit`, no `broadcastWanted`, no
> `recordEnabled`, no `watchedParams`, no `pendingTakes` — and has not been touched for ten
> minutes.

This is safe by construction, which is the point: dropping a session that holds nothing is
**invisible**, because the next message naming it recreates exactly the same thing. No work can
be lost, and a session with a loaded Edit is never auto-dropped however long its owner is away.

**It is not a refcount, and both obvious refcounts are wrong.** Counting *listeners* would drop
almost everything, since most sessions have no audio subscriber. Counting *connections* would
take a loaded project away on every tab reload. A session with no live socket may legitimately
exist; a session holding nothing may not.

**4. A grace on abandonment, which is a refcount with the objection answered.** The three rules
above share a gap: a project **stays loaded for ever** once nothing releases it. A closed tab
freed only the audio tap; a laptop that went to sleep freed nothing at all. The machine kept a
song's worth of plugins instantiated with nobody there, and the only way back was to restart the
engine — which is a large part of what "the engine is unstable" meant.

So sockets are counted after all, but only the ones that say they are **driving**:

```json
{ "type": "hello", "role": "driver", "session": "st0:fred_parapluie_org" }
```

A driver is a surface a person is looking at. Anything that does not say `role` is not one, which
is what keeps the file service out of the count — it holds a socket per session for as long as
the machine is up, so counting it would mean no project ever looked abandoned. The tray's polls
and every reachability probe are out for the same reason, without needing a rule of their own.

When a session's driver count reaches zero the clock starts, and **45 seconds** later the project
is let go: the transport stops, the Edit and its plugins are freed, and the SESSION stays — so a
tab that comes back re-sends its document into the same slot and every watch keyed on the id
still means what it meant.

The grace is the whole design, and it is what answers "a refcount takes a project away on every
reload": a reload is back in under a second, a redraw in less, and a flaky minute of Wi-Fi is
covered by the client's own reconnect. What is *not* covered — deliberately — is walking away for
a minute with the tab closed, because that is indistinguishable from being finished, and the cost
of guessing wrong is one `POST /open`.

Declared on **hello** rather than in a verb of its own so it cannot be forgotten: every surface
already sends one on every connection, including after a reconnect, which is exactly the moment
the count has to be restored. Registered once per socket — the browser's keepalive re-sends
`whoami` every few seconds on a quiet link, and those must not each be a driver.

> **A reload is not made cheaper by being told about.** An earlier version of this also had the
> browser send `drop-session` on `pagehide`, so closing a tab freed the machine at once. It was
> dropped: `pagehide` cannot tell a close from a reload, so every reload would have paid a full
> graph rebuild — the thing `applyFull` was just reordered to stop doing twice
> ([audit-stabilite.md](audit-stabilite.md)). The 45 seconds cost nothing and cannot be wrong.

### The socket side, in the file service

`packages/file-service/src/engineLink.ts` keeps one socket per session and used to prune them
only when the chosen engine changed. Since one file service can serve several people, an
abandoned link was not merely a leaked socket: its close handler re-dialled every second for the
life of the process, which kept that session alive on the engine too.

`pruneIdleLinks` now drops links untouched for five minutes, **without** telling the engine — the
person may come back and their project should still be loaded. `dropLink` deletes from the map
*before* closing, which is the ordering the reconnect guard depends on; closing first left the
outcome resting on the close event happening to be asynchronous.

Note that a person's two workspaces share one session (`engineLink.test.ts` pins this), so
switching *workspace* orphans nothing. Only a change of user or of engine does.
