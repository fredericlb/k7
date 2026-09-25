# Sessions inside the engine

One engine holds N projects. `packages/engine-protocol/docs/sessions.md` covers the id and the
client rules; this page is the engine's half — who may create a session, who may only look at
one, what the lock protects, and when a session goes away.

## The registry, and what the lock is on

`engine/st0-engine/engine/SessionRegistry.h` is a `std::map<std::string, std::unique_ptr<T>>` behind
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

### The race the registry exists for

`drainBroadcast` and `skipBroadcastToLive` reach a session **from the sender thread**, while the
message thread reaches one on every inbound message and every 50 ms state tick. A bare
`sessions[id]` — `std::map::operator[]`, which inserts — is therefore an unsynchronised structural
write from two threads.

"The ring outlives every edit" is true of the ring and does not extend to the **lookup that finds
it**, now that the ring lives inside a map keyed by session. The case is reachable rather than
theoretical: `main.cpp` records a new listener's session under `listenersMx` *before* the posted
`enableBroadcast` runs, so the sender thread can be the first to touch a brand-new id.

`tests/SessionRegistry_test.cpp` pins the invariants. Its concurrency case is a **stress test,
not a race detector** — MSVC ships no TSan, so on Windows it proves only "did not tear under
load". The real instrument is the `asan` preset on a platform that has the sanitisers.

## A session is created by a client DRIVING one, never by a reader

The rule, in one sentence: **the inserting `session()` is reachable only from the writes that
mean "this client drives this project"** — `apply` / `applyFull`, `enableBroadcast(on = true)`,
and `setRecordEnabled`. Everything else uses `find()` and has an obvious answer for absence:
the empty doc, `nullptr`, `-100 dB`, an empty vector.

Route a `const` accessor through the inserting form and three things follow at once:

- the **supervisor conjures the default session**. It polls `list-edit-plugins` on a timer with
  an `EngineControl` that has no session — so `DEFAULT_SESSION`, the empty string — and the
  first touch creates it. It then shows up in the tray's own Sessions submenu, reported by the
  process that has just invented it.
- the state timer re-touches every session it lists, forever.
- there is no "unknown session" path at all, because there is no such thing as an unknown one.

`main.cpp` still reads `session` with no allowlist, deliberately: naming a session is what
creates it, and a whitelist would mean the engine had to be told about every app in advance.
What it does have is a **ceiling** — an id longer than 256 bytes is refused, so a malformed
client cannot grow the map without bound.

### `list-edit-plugins` is engine-global

It is not a per-session question — with N projects there is no *the* loaded edit — and asking it
per session empties the tray's "Native plugin UI" submenu, since the supervisor asks on the
default session and that one holds nothing. So it walks every session and stamps each row with
the one it came from, exactly like `list-sessions`.

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

Leave a reply unstamped and `forSession` passes it to everyone: a pl8 module audition makes st0
flash `busy` and clear its warning badges, and st0 receives `applied`, `flushed` and `recorded`
for a project it does not own.

**`forSession` passes on absence anyway**, and that is deliberate. It is what keeps a current
client from going deaf against an engine that stamps nothing; the leak is never in that rule but
in the engine failing to disagree. A capability announced in `whoami` would only help if the
engine *forgot* to stamp something — and would then make the client deaf on that frame instead
of merely unsorted, which is strictly worse and equally silent.

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

## The two harnesses that check all this

`scripts/two-sessions.ts` and `scripts/list-sessions.ts` are the only coverage these rules have,
and they are worth reading before changing anything above.

`two-sessions.ts` drives two projects at once and then opens a **raw socket** that counts `state`
frames BY the session they name. The ordinary clients cannot show that: `forSession` drops another
project's frames before the event fires, so a client sees the same thing whether the engine
addressed its frames or shouted them at everyone. What the wire costs — a decode and a discard per
frame, per tab, per session on the machine — is only visible on the raw socket. It sends `hello`
exactly as the browser client does, since that is what declares a session; a socket that sends
nothing declares nothing, which is the probe case its last count covers.

Three regressions it exists to catch:

- **Record-enable is SESSION state.** As a process-global, arming st0 lights pl8's record light
  and rolling either one records into both.
- **Only ONE of them plays.** Without sessions the second project tears the first down; without
  the client half, the silent one reads the playing one's state frames as its own.
- **What is SENT, not what is kept.** A state frame is a per-track level array plus whatever
  waveform envelopes are subscribed, at 20 Hz. Shouted at every socket, each tab decodes every
  other project's meters to throw them away, and one session playing keeps every other session's
  tabs awake past their own idle divider.

Its body is wrapped in a function rather than using top-level await, because `engine/st0-engine`
declares no `"type": "module"` and tsx transforms it to CJS, where a bare await is a syntax error.

`list-sessions.ts` is **read-only against a REAL engine**: it must not send projects or drop
anyone's session, which is the difference between a diagnostic and a way to lose the song somebody
is working on. It connects the way the supervisor does — on the DEFAULT session, driving nothing
and asking about everyone — which is why `list-sessions` carries no session field at all. It asks
everything the tray polls BEFORE listing, because that is the regression it guards: should reading
ever CREATE again, those queries conjure a `""` session which then appears in the tray's own
Sessions submenu, reported by the process that has just invented it. It asks through
`EngineControl`, the way `engine/st0-supervisor/src/EngineQueries.cpp` does: one question at a
time, each waiting for its typed reply.

## When a session goes away

Three layers, and only the first two are required.

**1. Stop creating.** After the rule above, a session exists only because somebody sent it a
project or subscribed to its audio.

**2. `drop-session` is primary.** It is wired end to end — the tray's Sessions row, the
supervisor, `EngineControl.dropSession` and `EngineClient.dropSession` in the browser client.
The file service calls it from `unloadEngine`, the one place that genuinely means "this
workspace is done".

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
above share a gap: nothing in them releases a **loaded** project, so it stays loaded for ever. A
closed tab frees only the audio tap, and a laptop that goes to sleep frees nothing at all — the
machine holds a song's worth of plugins instantiated with nobody there, and the only way back is
to restart the engine.

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

> **A reload is not made cheaper by being told about.** Sending `drop-session` on `pagehide`
> would free the machine the instant a tab closes, and it is not done: `pagehide` cannot tell a
> close from a reload, so every reload would pay a full graph rebuild — the thing `applyFull` is
> ordered to do only once ([audit-stabilite.md](audit-stabilite.md)). The 45 seconds cost nothing
> and cannot be wrong.

### The socket side, in the file service

`packages/file-service/src/engineLink.ts` keeps one socket per session. Since one file service
can serve several people, an abandoned link is not merely a leaked socket: its close handler
re-dials every second for the life of the process, which keeps that session alive on the engine
too.

`pruneIdleLinks` drops links untouched for five minutes, **without** telling the engine — the
person may come back and their project should still be loaded. `dropLink` deletes from the map
*before* closing, which is the ordering the reconnect guard depends on; closing first rests the
outcome on the close event happening to be asynchronous.

Note that a person's two workspaces share one session (`engineLink.test.ts` pins this), so
switching *workspace* orphans nothing. Only a change of user or of engine does.
