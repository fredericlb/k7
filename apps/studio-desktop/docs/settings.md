# The settings are a page, not a menu

Everything the menu-bar icon carried — the engine, the audio interface, the sessions, the
plugin windows, the web-UI allowlist, the server, the machine's own folders — is at
**`/@settings`** in st0. The icon keeps only what a page cannot be.

## Why move it

A menu can grey a row out. A page can say why. Every rule on this screen has a failure that
looks like working software, and each one now has room for the sentence:

- Stop is refused on an **adopted** engine, and says *"this engine was started by another
  supervisor"* rather than being mysteriously dim;
- a dead file service is a line of its own — the engine is up and no browser can reach a file,
  so "running" alone would be a lie;
- a ranked audio device that is not plugged in still gets a row, because otherwise "why am
  I not on my interface?" has no answer on screen;
- dropping a session says what it drops, where the tray had a `✕` and hoped.

## Why `/@settings`

A sentinel, like `@shares`, `@banc` and `@local`. A plain `/settings` would make `settings` a
repository name that could never be opened — on the hosted origin too, for ever — because a
single segment is a legal project address. `@` cannot begin a git short name, so this costs
nobody anything. `@studio/web-protocol/projects` owns the word.

## How st0 knows it is in the app

It **asks**. `GET /desktop/state` exists only where the desktop app serves st0 itself; a hosted
backend has no such route and answers 404. So:

- the same bundle ships to both, with no build flag to keep in step and no user agent to sniff;
- the home page offers the link only where the probe answered;
- someone who types `/@settings` on the hosted studio gets a sentence, not a broken screen.

## The three routes, and why they are loopback only

| route | what |
|---|---|
| `GET /desktop/state` | the supervisor's snapshot plus the app's own half — identity, server, autostart, LAN addresses |
| `POST /desktop/command` | one `HostCommand`, straight through: the screen sends exactly what the menu sent |
| `POST /desktop/local` | the rows the supervisor has no command for — autostart, opening a folder, pairing |

All three refuse a non-loopback caller. They start and stop an engine and edit the CORS
allowlist; a second device on the LAN has no business doing either, and `origin.ts` is the same
predicate the pl8 proxy uses.

The command route is **fire and forget**, exactly as the menu was: the answer is the next
snapshot. A reply that pretended otherwise would be reporting something the supervisor never
said. The screen polls at 1 s — the supervisor already publishes only on change, and a second's
lag on a settings screen is a second nobody notices, where a socket would be a reconnect policy
nobody asked for.

## Three tabs, and they are not the window's

It carries **no app bar**. Every other screen in st0 has one, and this one is opened as a window
TAB of its own (`docs/tabs.md`): the strip above it already says which tab you are on, so a second
row naming the app would be chrome over chrome on the screen that has the least to show for it.
Nor a way back, for the same reason — a link to `/` would open a second home tab beside the first
rather than return to it.

The page grew past a screen, so it is split — **Audio**, **Server**, **Sync**, **Misc** — by a strip
`Section.tsx` draws. These are tabs on ONE page: they choose which part of a single
`/@settings` is visible. The window's tabs (`docs/tabs.md`) are a different thing entirely —
each of those holds a project, and only the one in front holds it at all.

The sections all live in `apps/st0/frontend/src/settings/`:

| tab | sections | why together |
|---|---|---|
| Audio | Engine, Audio interfaces, Sessions | what makes sound, which hardware it makes it through, and what is currently asking it to. `EngineSection.tsx`, `AudioSection.tsx`, `SessionsSection.tsx` |
| Server | Server, Web UIs, A second device | every way something OUTSIDE this machine reaches its engine. `ServerSection.tsx` |
| Sync | Deploy key | what lets a repository be cloned and pushed at all. `SyncSection.tsx` |
| Misc | This machine | autostart, the folders, the build — set once and left. `MachineSection.tsx` |

Audio is first because it is the tab someone opens this screen mid-rehearsal to fix: the
interface is not the one it was, or the engine needs a restart.

## Sync is the one tab the hosted studio still draws

The deploy key came off st0's home page, where it sat at the bottom of the screen someone opens
to start work every day — for a value pasted at a git host **once**, per account, and then never
looked at again. That is a settings row, and the home page was paying for it daily.

It is not a desktop fact, though, and that is the whole difficulty: the key is the ACCOUNT's, pl8
answers for it over the session cookie, and taking it off the home page would otherwise have put
it out of reach of anyone using studio in a plain browser — where `/@settings` says "these
settings belong to the desktop app" and stops.

So the probe now decides how much of the page to draw rather than whether to draw it:

- **in the app** — four tabs, Sync among them;
- **hosted** — the Sync section alone, above the sentence saying the other three belong to the
  app. No tab strip: one tab is not a choice, and a strip with three dead entries would offer one
  that isn't there.

`SyncSection.tsx` therefore takes no `DesktopState` and sends no `HostCommand` — it calls
`projects.sshKey()` like the home page card did. It is the only section on this screen with no
supervisor behind it, which is exactly why it survives the probe failing.

The tab is component state and not in the address. Every row is drawn from the 1 s poll, so a
tab off screen holds nothing worth keeping — it is unmounted, and the next snapshot fills it in
under a second. A `/@settings#server` would only be a second thing to keep in step with the
strip, for a screen nobody links INTO.

The split cost `MachineSection.tsx` its server half, which is now `ServerSection.tsx`: it drew
four sections for two tabs, and a component that has to be broken across a tab boundary is the
one signal that it was two components.

## The interfaces are a ranking, and there is no "use this one"

The rows are the user's list, best first, and the engine goes to the highest one plugged in.
So the only actions on a row are ↑ and ↓: choosing an interface and choosing what to do when it
is missing stopped being two questions, which is what the old Use / Fallback pair made of them.
The policy is the supervisor's — `packages/engine-host/docs/supervisorPolicy.md` says why a list
replaced a pick and a fallback.

Three things the screen decides on its own, in `rules.ts` and tested there:

- **A device nobody ranked is listed last, unnumbered, and says "not ranked".** It is a real
  device and hiding it would make the list look wrong; but the supervisor will never switch to
  it, and a number would claim otherwise.
- **A row is either in the list, with arrows, or not in it yet, with one Rank button.** Not
  both: three buttons on a row that has only ever needed one is how the old Use / Fallback pair
  read. Rank puts the device where it already sits on screen, which ranks everything above it
  too — a position means nothing without the rows it is under.
- **Every action sends the WHOLE visible order back**, not "move X up". That is what makes the
  single-interface case work at all: one unranked row has nowhere to move to, so an arrow would
  be permanently dim and the device could never be ranked.
- **Forget is offered on an absent row only.** A ranked device you demote is still on screen and
  can be moved back; a name for hardware you sold is the one entry the arrows can never get rid
  of. On a present device the same button would read as "stop using this", which it is not.

`audio.priority` carries the order as one U+001F-joined argument (`PRIORITY_SEP`), the same
trick `plugin.showUI` uses — a command takes one argument, and a ranking is one value.

## What the icon still does

Presence, and a way back. It exists because the app outlives its window — it serves an engine
to the web version and to a second device, so closing the window cannot quit it, and after
"start at login" there is no window at all. Four rows: **Open studio**, the status and registry
lines, **Settings…**, the build, **Quit**.

The rules that used to live in `menu.ts` moved WITH the screen, into
`apps/st0/frontend/src/settings/rules.ts`, and are tested beside it. They are plain functions
rather than inline JSX for the reason they were worth testing in the menu: `SHOW_UI_SEP` in a
plugin row, the ownership check, the "preferred" gap. `menu.test.ts` now asserts the opposite —
that none of those ids are in the menu any more.
