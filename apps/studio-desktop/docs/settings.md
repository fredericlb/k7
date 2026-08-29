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
- a remembered audio device that is not plugged in still gets a row, because otherwise "why am
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
