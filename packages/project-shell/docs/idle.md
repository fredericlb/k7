# Twenty minutes with nobody there — the session closes, and a button reopens it

A tab open on a project is not passive: it holds a socket to the engine, it holds a **lease** on the
machine, and the engine holds the project loaded — plugins instantiated, graph built, audio ready.
That is what it takes to play a note straight away. It is also what a tab forgotten behind three
windows keeps to itself all night.

After **twenty minutes** without a gesture, that tab stops being a client of that engine: it
unmounts, the project is unloaded, the lease is returned. A screen says so, with a "Resume session"
button.

## What "idle" means, and what it does not

`src/idle.ts` holds a **timestamp**, reset to `Date.now()` by five `window` events, in capture:
`pointerdown`, `pointermove`, `keydown`, `wheel`, `touchstart`. A fifteen-second `setInterval`
compares it against the delay.

**A date rather than a `setTimeout` cancelled and re-armed.** Three reasons, and the third decides:

1. `pointermove` has to count — running the mouse over a waveform while listening is activity — and
   it fires dozens of events a second. Against a timestamp that is an assignment; against a timer it
   is a `clearTimeout` plus a `setTimeout` every time.
2. A background tab has its timers throttled to about a minute by the browser. At twenty minutes the
   lateness is noise, but it must be **bounded** rather than accumulated, which a coarse interval
   guarantees and a chain of timers does not.
3. **A machine that sleeps.** A closed laptop runs no timers; on waking, a twenty-minute
   `setTimeout` picks up where it left off and waits again. A date tells the truth at once: two
   hours have passed, the session is over.

### A playing song is not an idle session

That is the case with no input events at all, and yet the most obvious use of this application:
listening. Cutting a forty-minute set at the twentieth, unloading the project and so killing the
sound, would be the worst bug this page can produce.

`markActive()` is the door, and it is deliberately stupid: an exported function that sets the
timestamp, with no React state to lift from the bottom of the application. st0 beats it once a
minute while the transport plays (`App.tsx`, beside `playing`). One minute against twenty: the beat
cannot miss the window, and it costs nothing. Anything that happens untouched and must count goes
through it. Nothing else should need to know this module.

### A tab moved behind another sleeps at once

The same sleep, without the twenty minutes: in the desktop app a tab that is no longer in front
returns its lease and unloads its project immediately — a machine holds one project at a time
(`apps/studio-desktop/docs/tabs.md`). `ProjectGate` takes an `asleep` prop for that, putting it in
the `idle` phase exactly as the timer does.

The phase remembers **why** it fell asleep, and that field carries: a tab brought back to the front
wakes on its own, a session closed by the TIMER waits for a hand on the button. Without the
distinction, automatic waking would undo this whole page.

### The timer is armed only during the `open` phase

`ProjectGate` passes `0` in every other. A clone in progress, an error, the screen sending you back
to choose: those are already cards with nothing running behind them, and expiring them would swap
one card for another without freeing anything.

## What closes, in this order

The `idle` phase of `ProjectGate` is a screen like the others: it **replaces** `children`. That is
where the order comes from, and the order is not a detail.

| | what happens | who does it |
|---|---|---|
| 1 | `children` unmounts | React, at the commit that sets the phase |
| 2 | the app's engine hook cleans up → `EngineClient.dispose()` → the WebSocket closes | the application |
| 3 | `onIdle()` — what the app holds and the gate does not see | the application |
| 4 | `POST /engine/unload`: stop, flush, `served.delete`, `drop-session` | the file service |

Steps 3 and 4 are in an **effect** and not in the timer callback, precisely so that they land after
step 1's commit. Called from the timer, the flush races a socket still open, which may well have
pushed a document in behind it.

`unloadEngine` is exactly the call `quit()` makes — leaving a project and falling asleep on it are
the same close, and only one is written.

`onIdle` is held in a **ref**, and that carries: an application passing an inline closure would
give a fresh `onIdle` on every render, and with it in the dependencies the effect would replay —
returning the lease and emptying the engine on every frame of the idle screen.

A failure is **ignored**. The engine gone or the machine away is one of the reasons a tab sits
twenty minutes untouched; the screen offering to reopen is the right one either way.

### The lease belongs to the app, not here

`onIdle` / `onResume` are callbacks and not an import, for the reason
[`ProjectTakenOver`](../src/ProjectGate.tsx) already writes: this package **deliberately does not
depend** on `@studio/engine-browser`. In st0 it is `EngineGate` that holds `holdEngine`, one notch
above `ProjectGate`; it passes an `asleep` flag into its effect's dependencies, whose cleanup is
`release`. A tab with no socket and no loaded project that still renewed its claim every five
seconds would not be disconnected — it would be squatting.

## Resuming is reopening

The button does three things: `onResume()`, the `resolving` phase, and `attempt + 1`. The last
replays **the full setup effect** — resolve the repository name at pl8, clone if the machine has
forgotten the workspace meanwhile, `POST /open`. That is what makes this screen so flat: reopening
a project is a route the gate already owns, and being asleep only takes it again.

Two things it does NOT do, both deliberate:

- **no automatic resume.** The point is to stop being a client of that engine; a tab reconnecting on
  the first mouse move would have spent twenty minutes gaining nothing. A hand on a button reopens.
- **no guarantee of getting the machine back.** Resuming is a deliberate reopen, so a proper retake
  of the lease: if someone moved in overnight, `onLost` answers and `ProjectTakenOver` shows — the
  screen that already exists for it, with the right words.

## What this does not cover

**The login session does not move.** The `studio.sid` cookie is worth seven days and is not
sliding; nothing here touches it. Deliberate, and worth saying, because "disconnect" reads both
ways: what closes is the link to the ENGINE, not the identity. Logging out for good is still
`ui logout`.

It could not be otherwise in that direction: the file service does not know that cookie — it
authenticates on the `x-studio-*` headers — and the engine on a token. Expiring the session would
stop nothing at all; disconnecting explicitly is what this page does.

**`0` disables.** An application that does not pass `idleTimeoutMs` registers no listener and never
reaches this phase. The screen's three strings are optional for the same reason — the harness
pattern of `ProjectGateStrings`. st0 is the only one that turns it on.

## What to check in a browser

Nothing here is covered by a suite: the timer measures twenty minutes and the screen mounts in no
test.

- open a project, touch nothing for twenty minutes → the idle screen, and the engine plays nothing;
  "Resume" brings the project back;
- while idle, ask the engine for its sessions → this one holds no project;
- while idle, list the engines from another tab → this one is no longer "in use";
- **start a long song playing and touch nothing** → after twenty minutes it is still playing. That
  is the check holding up the whole `markActive` paragraph;
- resume from another tab that has taken the machine meanwhile → "This project was opened
  elsewhere", not an error;
- close the laptop for an hour, reopen → the idle screen at once, not twenty minutes later.
