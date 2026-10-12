# Overall findings — the audio axis

Scope: `apps/st0`, `engine/st0-engine`, `engine/st0-supervisor`, `engine/st0-tray` and the packages they drive. Out of
scope: `apps/z0` and the rehearsal recorder (`packages/rehearsal-server`, `packages/ui-rehearsal`).

This page is **self-contained** — it carries its evidence rather than pointing at it — which means
it goes stale. The remedy is not to believe it but to replay it: the last section gives the exact
commands. A false entry must be discoverable in thirty seconds.

The five specialised pages keep what only they hold:
[audit-perf-web.md](audit-perf-web.md) (the costed lots),
[audit-moteur.md](audit-moteur.md) (what links a surface to the engine),
[inventaire.md](inventaire.md) (dead code),
[tests.md](tests.md) (what the suite covers, and the two times it lied) and
[engine/st0-engine/docs/audit-stabilite.md](../engine/st0-engine/docs/audit-stabilite.md) (the C++).

---

## The thesis

**This repo hardens the face it is looking at, and leaves the twin bare.**

That is not negligence: it is the signature of serious work done one breakdown at a time. You fix
where it hurts, and the symmetrical thing — which has not hurt yet — stays naked.

| hardened | the twin, left bare |
|---|---|
| The web is benched, figures published | No C++ bench, no browser bench |
| An `unhandledRejection` / `uncaughtException` net at both TypeScript entry points | Neither a `try` at `main()` level nor `set_terminate` in C++ |
| st0's gate: lease, re-look, full predicate | z0's: no lease, no re-look, reachability that ignores the token (out of scope) |

And the consequence holding all three axes together: **there is no automatic guard on
performance.** No non-regression gate. What is not tooled is checked by hand, and so slips.

The failure mode to look for first is **not what is missing, but what exists and does not run.** An
unrun test is indistinguishable from an absent test on a dashboard, and far more expensive, because
it additionally gives the illusion of coverage.

---

## Performance

### A bench measures two regimes at once unless it ages its fixture

`yamlCache` refuses to cache a file whose mtime is younger than 2 s (`SETTLE_MS`), for a reason
written in the file. A bench that writes its fixture then measures **immediately** *cannot* hit the
cache on the first iterations and hits it on all the rest: the mean mixes two populations and the
variance makes the bench unusable. The fixture is aged by an hour (`utimesSync`) — the regime a
real song is in.

Reference figures on this machine, aged fixture, **three passes**:

| bench | 8 tracks | 64 tracks |
|---|---|---|
| `compileNodeProject` | 3.86 – 4.19 ms, rme ±1.5 to ±1.8 % | 22.8 – 26.8 ms, rme **±5.6 to ±14.7 %** |
| `buildGraphDoc` | 4.25 – 5.91 ms, rme ±1.6 to ±3.9 % | 34.0 – 51.5 ms, rme **±0.9 to ±14.0 %** |

Three readings:

1. **The variance does not hold at 64 tracks.** Up to **±14.7 %**, and `buildGraphDoc`'s mean moves
   from 34 to 51 ms between passes. The 8-track means are stable, so this is not a code regression:
   **the bench has stopped being an instrument** at that size. Probable and undemonstrated cause: the
   big fixtures draw only 10 to 22 samples, so a single scheduling stall dominates — and this machine
   had Tilt and a live `st0-engine.exe` during the measurement. **Practical consequence: conclude
   nothing from a gap of less than 15 % at 64 tracks** without first stopping the dev session and
   repeating the pass.
2. **The two benches measure different things.** Cold-cache they are both dominated by the same YAML
   reads and return the same figure, which suggests `buildGraphDoc` costs nothing extra. In the open
   the gap is **11 to 13 ms** on the quiet passes — `buildGraphDoc`'s own work, the clip extents.
   That is the item to watch as a song grows.
3. The curve is gentle: 8× the tracks still costs **5.8×** on the compile.

Page: [`packages/song/docs/benchSettle.md`](../packages/song/docs/benchSettle.md).

### Do not cache zod's `safeParse`

The YAML parse is cached, the `safeParse` is not, and it looks like the next item along. Measured:
**1.0 % of a 64-track compile**, 1 to 2.5 % at 8. And caching it would break an invariant `loader.ts`
states outright — the cached parse is safe *only because* `r.data` is a fresh structure, so nothing
shared escapes the loop. Do not do it.

### Post-command reloading is targeted, and what that really costs

The revision token is `${mutations}:${count}:${newest}`, and `mutations` is incremented by EVERY
write: it moves for everything, by construction. It cannot be finer without becoming wrong again —
it is what defends against two writes in the same millisecond, the same trap `SETTLE_MS` parries in
`yamlCache`. Precision therefore comes from the client: `POST /command` returns the list of files
written (`changed`, project-relative), `reloadKey` is `{ key, files }`, and `EditorTab` re-asks for
`/tree` and `/hints` only if what moved can have moved them.

| what changed | `/tree` | `/hints` |
|---|---|---|
| a file appears or disappears | yes | yes |
| rewrite of a `clips/`, `sequences/`, `curves/` | no | no — they are listed BY NAME |
| rewrite of anything else | no | yes |
| list absent (`null`) | yes | yes — nobody said anything |

`null` ≠ `[]` is the load-bearing point: a service that could not diff says "I do not know", and
everything reverts to the old counter. Opening a project, an undo, a `project pull` and the
`/revision` tick therefore need know nothing of this mechanism. `/project-doc`, `/graph` and
`/project-errors` stay unconditional: a write really can change them.

Two limits, said rather than hidden:

- `/module-libraries` and `/library-chains` read the **shared folders**, which a project command
  cannot touch: they are read when the pane mounts, and reloaded by the only three acts that change
  them — creating a module, forking a shared module, publishing from the builder. A library changed
  **outside this tab** (a `project pull`, another browser) therefore appears only at the next mount.
  That is the bargain "Many browsers at once" already takes everywhere else.
- A clip's `source` also decides whether it is listed as an audio or a video clip. A command
  re-pointing an EXISTING clip from a wav to an mp4 would leave that one split stale until the next
  full reload. The predicates and their tests are in `apps/st0/frontend/src/reloadScope.ts`.

The same reasoning holds for gestures: `quietCommand` (`want: []`, no bump) carries its own
measurement — "62 ms per mute, per solo, per knob turn, built and dropped". Warp gestures borrow it,
which holds them at ~130 ms instead of ~465.

### What remains, in order of return

1. **`ClipWaveform` re-renders its host at frame rate.** It reads the transport with
   `useEngineState((s) => s.playhead)` — a SELECTOR hook — when the repo already has the answer:
   `usePlayheadFrames`, which subscribes to the raw store, never renders, and writes to a DOM node at
   60 Hz. Its header says exactly why. It cannot be substituted as is, because `Waveform` draws its
   playhead *on the canvas*: a thin overlay layer is needed. That is the gesture `layers.md` rejects
   for progress FILL, for a reason that does not apply here — a purple wash over the bar numbers
   shows, a one-pixel line does not.
2. **`App.tsx`: 4,200 lines, 51 `useState`, 11 `useMemo`, no memoised panel.** A layout panel is
   mounted once and never unmounted (`hidden` takes it off screen), so any state change re-renders
   `TimelineTab`'s 3,513 lines **even hidden**. The only existing profile (`timeline.md`) predates
   lots C and D — re-measuring is the prerequisite, not the fix.
3. **Engine side**: `Change`, a fat value type, copying the whole `PluginDoc` *per parameter*
   during a knob drag; `diff()` rebuilding four `std::map`s with concatenated keys per apply; and the
   pattern clock path paying **two deep copies of the `ProjectDoc`** per tick, at 6.7 Hz.

### Already excellent — do not re-suspect

The audio callback is allocation-free and its only locks are `try_lock`s that drop a block.
`BroadcastTap` is an exemplary SPSC ring. `moduleCache` and `yamlCache` carry their **measured**
reasoning, including a case where hoisting a scope proves slower. `engineStore` quantises in the
selector. And `meters.md`'s "the O(n²) that is not worth it" table is a costed verdict: the memoised
Map LOSES below ~50 tracks.

### The control path is not a bottleneck, and it looked like one

Measured against a loaded engine, on `eqA:eqA` (12 parameters), re-sending the CURRENT value each
time so the whole path runs without the sound moving:

| send + full drain | control (nonexistent `id`) | real settings |
|---|---|---|
| 5,000 messages | 45 ms | 45 ms |
| 20,000 messages | 168 ms | 173 ms |

That is **between 0.2 and 0.9 µs of engine work per setting** depending on the pass — the gap is
measurement noise, which is already the answer — and a throughput of about **110,000 per second**.
Scratching, at its worst, used less than a thousandth of it. And a probe posted behind 20,000 queued
messages returns in 1.1 ms: the `callAsync` queue does not clog.

Three things to keep from it:

- **Reading the code said the opposite.** `pluginParams()` rebuilds the entire parameter vector, each
  entry carrying four `std::function`s, then compares by `toStdString()` — a hundred allocations per
  setting were expected, so microseconds. The measurement says under one microsecond. **Do not
  optimise this path without re-measuring first.**
- **The real cost is BROWSER side.** 168 ms to emit 20,000 messages is 8.4 µs per message in
  `JSON.stringify` + `ws.send`, on the main thread drawing the desk. That is what throttling the
  scratch saves — not the engine.
- **So it does not explain the bugcheck.** `KMODE_EXCEPTION_NOT_HANDLED` in `FocusriteUsb.sys` stays
  a driver defect with no lever on this side. Under ASIO the driver CALLS us; there is no instruction
  queue towards the card. What can fault a driver is a late or blocking callback, and the control path
  never touches the audio thread. The real candidates are in
  `engine/st0-engine/docs/audit-stabilite.md`, "Real-time safety".

Replay with `engine/st0-engine/scripts/param-cost.mjs` against an engine that has a project loaded —
without one, the `set` stops at the map miss and measures the control on both sides.

### The audio callback is at 5 % of its deadline, gesture included

Tracktion already measures every block (`DeviceManager::getCPUStatistics`, mean/min/**max**); the
`audio-cost` verb exposes it, and `engine/st0-engine/scripts/callback-cost.ts` drives the scratch and
reads it either side.

At buffer 512 / 48 kHz — a **10.67 ms deadline per block**:

| state | blocks | mean | worst block |
|---|---|---|---|
| engine idle, nothing loaded | 563 in 6 s | 0.010 ms | 0.046 ms (0.4 %) |
| desk loaded, record turning | 90 s, 30 windows | 0.13 ms | 0.476 ms (4.5 %) |
| … no gesture, 5 s window | 469 | 0.178 ms | 0.565 ms (5.3 %) |
| … **scratch driven at 2918 settings/s** | 469 | 0.201 ms | 0.456 ms (4.3 %) |

The scratch — three times a mouse's rate — adds **0.023 ms** to the mean and *lowers* the maximum:
the gap is noise. The block count does not move either (93.8/s, the exact value for 512 at 48 kHz),
so no block is lost.

At **256**, where the buffer sits, same desk and same driven scratch — 5.33 ms deadline:

| state | blocks | mean | worst block |
|---|---|---|---|
| empty | 938 in 5 s | 0.007 ms | 0.137 ms (2.6 %) |
| loaded, no gesture | 1126 in 6 s | 0.127 ms | 0.493 ms (9.3 %) |
| loaded, **scratch at 2863/s** | 1125 | 0.144 ms | 0.508 ms (9.5 %) |

**The cost does not halve with the block.** Going 512 → 256, the loaded mean does not fall by half
(0.201 → 0.144, −28 %) and the maximum does not move at all (0.456 → 0.508). Part of the callback is
a FIXED per-block cost — graph traversal, plugin calls, bookkeeping — that does not know the block
size. So **halving the buffer roughly doubles the share of deadline consumed**: 4.3 % at 512, 9.5 %
at 256. The margin is still an order of magnitude, but the trend says what 128, and above all 64,
would cost.

**The one thing that really reaches the driver** is `list-audio-devices`, which calls
`scanForDevices()` on every type, ASIO included. Measured: **50 ms per scan**, six times out of six.
The callback does not suffer (max 0.278 ms during a burst against 0.356 without), so it is not a
real-time problem; it is the only repeated solicitation imposed on a single-client driver while it is
streaming. `DEVICES_POLL_MS` is at 10 s — 360 scans an hour instead of 1800; a near-zero-cost
experiment, not a proven fix: `engine/st0-supervisor/docs/supervisorPolicy.md`.

**What this closes.** The engine never approaches its deadline: a factor of twenty of margin on the
worst block observed, in every condition tried. The "we send the card too many instructions" theory
is dead twice over — the control path is free, and the audio thread does not notice it.

**Knowing whether the desk is REALLY loaded**, before counting anything:

- `tracks=3` IS the fallback document (`deckDoc`) — two decks and the sum. A compiled desk announces
  17.
- Asking for `stemDrumsA:platter` does NOT decide, because `deckDoc` builds the platters too. The
  plugin answers in both cases.
- `loaded=true` does not decide either: the fallback document is a loaded document.

The only reliable witness is therefore the **track count**, compared with what the project compiles.
A measurement taken on the stand-in measures a graph with no EQ, no filter and no fades.

## Stability

### The exception net

`void f()` catches nothing — it tells Biome the promise will not be awaited — and since Node 15 an
unhandled rejection **terminates the process**. TypeScript side, one `guard()` per process and the
net at both entry points cover that, with the two halves deliberately asymmetric: a rejection is
logged and we live, an uncaught exception is logged with its stack and we exit. Page:
[`packages/file-service/docs/background.md`](../packages/file-service/docs/background.md).

The failure mode that net parries is instructive because it goes unnoticed: when the supervisor
dies, **the engine stays alive behind it**, the tray restarts it on its fallback and the new
supervisor re-adopts the engine by its pidfile. It recovers, so it passes unseen. Same family on the
file-service side, where `wrap()` can see nothing: it only catches what the handler *returns*.

**The C++ nets its threads, not its `main()`.** Every job posted to the message thread runs inside
one `try` (`EngineHost::post`), the socket dispatch inside another, the pattern worker inside a
third, and the detached threads a message starts are counted and waited for at shutdown
(`engine/st0-engine/docs/audit-stabilite.md`). A throw from a thread nothing wraps — JUCE's own, or a plugin's —
still ends the process, but no longer without a word: `serve()` installs a `set_terminate` that
logs what was thrown before it aborts.

### git blocks the process holding the engine

`packages/commands/src/git.ts` does everything with `execFileSync`, and so do the routes. That
process holds the socket to the engine, the pattern clock and the watcher. The commands are bounded,
but the substance remains: `gitStatus` does a blocking `fetch` of up to 30 s, and **there is no lock
anywhere**. `commitAndPush` does `add -A`, then `status`, then `commit` in three subprocesses: an
autosave write landing between the first and the third is outside the commit. And
`cancelAlternative` does `reset --hard` then `clean -fd` with no exclusion.

### The engine token goes out on any socket

The engine returns its token to **any socket** sending `whoami`, with no authentication, and the
browser stores it. What the token really proves (anti-confusion) and what it does not protect are in
[`packages/engine-registry/docs/token.md`](../packages/engine-registry/docs/token.md). Tightening it
is a lot, not a sentence.

### Tests: what nobody covers

`engine-browser/src/engine.ts` — **673 lines**, where the whole reliability of the browser client
lives — **still has no test file**. Its five neighbours have one (`choose`, `lease`, `meter`,
`playheadClock`, `streamPlayer`); it does not. More broadly: **no test crosses a process boundary**,
and **no C++ ↔ TS contract** holds the binary frame.

Two traps are measured in [tests.md](tests.md) and hold for any measurement made here: a bench or a
test that does not run is green, and a failure that **changes test on every pass** is a time budget
too short, not a bug — five seconds by default for 160 files touching the disk.

### Already solid

The engine's browser client in its entirety. `moduleWatch` with its three halves — the watcher, the
10 s ceiling that heals a lost event, and the writer half, because `fs.watch` delivers one tick too
late. The lease on a project, tested 21 times. And `reconcileEngine`, the written answer to what the
code itself calls "the quietest failure in this repo": sending to an empty session.

---

## Dead code

### The tool, and what it does not see

Biome sees only intra-file — an `export` nobody imports is invisible to it **by construction** — and
`biome.json` excludes `engine/st0-engine`. `npm run lint:dead` (knip, `knip.json`) does three of
`inventaire.md`'s four passes in thirty seconds. **Non-blocking**: a false positive is read, it must
not block a merge.

Its exception list is the inventory's §0 translated into configuration, without which it kills live
code: `dspRunner.mjs`, `emit.ts`, the `jsdsp.ts`
files, the harnesses in `engine/st0-engine/scripts/`.

Output: **1 file, 1 undeclared dependency, 2 undeclared binaries, 120 exports, 45 types** — 169
findings, each to be examined. A rising count is not readable on its own: shrinking a published
`exports` map moves findings out of the shadow and into the list, so the count goes up because the
`package.json` lies less. Read it against the `exports` maps of the same day.

### Run `lint:bytes` BEFORE `lint:dead`

One NUL byte in a source file is enough for ripgrep to class it binary and skip it **without a
word**: the file stops existing for every reachability pass. `npm run lint:bytes` is the guard, and
it only helps if it is run.

That trap costs more than it looks: knip reads source the way ripgrep does, so a file carrying a NUL
is invisible to the dead-code detector itself, which will return a perfectly false "nothing to
report". And take care when describing the problem — copying the byte out of the source to
illustrate it reintroduces the NUL into the page.

---

## The open lots

Each is a design decision, which is why none is taken in passing.

1. `Change`, a fat value type.
2. `Waveform`'s overlay layer, to take the playhead out of the full redraw.
3. `App.tsx` — **re-measure before touching**: the only profile predates lots C/D.
4. `git` out of the service's process, or serialised behind a lock.
5. The token handed to any socket, and `STUDIO_ENGINE_HOST` at `0.0.0.0` by default.
6. The exception net on the C++ side.
7. The missing tests: `engine.ts`, the first inter-process test, the first C++ ↔ TS contract.
8. `ui-eyes`' WebCodecs block, which has no host.
9. **The 64-track bench, which no longer measures anything usable** (±14.7 %). Either give it enough
    samples and an idle machine, or stop publishing its figures.

---

## How to replay this survey

```
npm run lint:bytes                         # BEFORE lint:dead, or the second lies
npm run lint:dead                          # knip — read the OUTPUT, not the exit code
npm run bench --workspace @studio/song     # sequentially: two benches in parallel
npm run bench --workspace @studio/file-service   #   compete and the figure lies
npm run test                               # no cache anywhere in this chain — always a real run
npm run typecheck
```

**Stop the dev session before the benches.** Tilt and a live `st0-engine.exe` are enough to take the
64-track variance from ±1 % to ±15 %, which invalidates any comparison made on a loaded machine. And
**three passes, not one**: at that size the bench draws ten to twenty samples, enough for a single
pass to lie without looking like it.

To check this page's claims one by one:

```bash
# the net — must find both background.ts, and NOTHING in C++
# git grep, NOT grep -rn: the latter sweeps dist/ and returns 700 KB of minified bundles
git grep -n "unhandledRejection\|uncaughtException\|set_terminate" -- . ':!commons'

# the token goes out on any socket
git grep -n "engineToken" -- engine/st0-engine/server/

# one catch in the library, and main() is unguarded
for f in $(git ls-files 'engine/st0-engine/engine/*.cpp' 'engine/st0-engine/engine/*.h'); do
  n=$(grep -cE 'catch\s*\(' "$f"); [ "$n" -gt 0 ] && echo "$n $f"
done
```

Four measurement traps already paid for here: read the **number of tests** and not the exit code
(`docs.test.ts`'s empty glob passes on nothing); distrust tests driving real git that time out under
load — question them a second time before blaming a change, they have lied twice in one session on
two different tests; **a command piped into `tail` returns `tail`'s exit code**, that is zero, which
had "exit 0" read off a `biome check` reporting four errors; and on this machine `.claude/` holds a
score of worktrees, so a root glob that does not exclude them reports results from other branches —
`vitest.config.ts` excludes them now, hand-written greps do not.
