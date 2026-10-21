# Remote — keeping a hand on the machine when the dev session dies

Working on the studio from elsewhere hangs on one rule: **the door must not die with the
dev session.** An editor started *inside* `npm run dev` closes the moment the session
crashes, which is exactly when it is needed. So two services come up with the machine and
survive independently of each other, installed as Windows logon tasks by
`scripts/remote.mjs` — while the dev session (`npm run dev`, Tilt) is started from either
of them and runs under an orchestrator with a web UI, so "see what broke and restart it"
is a button in a browser, not a terminal you no longer have.

The way in is not one of them. `https://app.priv.k7.rocks` resolves to the
**LAN server**, which reverse-proxies to these ports; nothing this workstation starts
terminates TLS, so the door stays open even when everything below has crashed — a local
edge would be one more logon task able to take the door down with it.

| what | where | task |
|---|---|---|
| the browser editor | `https://code.priv.frediver.se` | `studio-vscode` |
| a shared shell | `https://console.priv.frediver.se` | `studio-console` |

Each is its **own origin**, routed by hostname on the LAN proxy (`code.priv.frediver.se`
→ :8798, `console.priv.frediver.se` → :8797, nothing to strip — both servers answer at
`/`), and both start in the **user's home**, with **Git Bash** as the default shell.
Subdomains of the owned zone on purpose: real names get real
certificates — a made-up or HSTS-preloaded TLD (`.dev`…) would mean an internal CA, and
VS Code web needs a secure context (service workers), so plain HTTP is not an option
either.

The dev session is **not** one of them:
`npm run dev` (which *is* `tilt up`) is run by hand — typically inside a
`console.priv.frediver.se` tab, whose PTYs the console service owns, so the session survives
every browser.

## The logon tasks

```bash
npm run remote:install     # register the two tasks + start them
npm run remote:status      # task states + who is actually serving
npm run remote:uninstall   # unregister and stop them
```

They are launched through `scripts/hidden.vbs` so a boot does not open console
windows. `remote.mjs run <name>` is the wrapper the tasks actually execute: it
relaunches a dead service with a backoff (5 s doubling to 5 min, reset after a
minute of good service) and appends everything to `%TEMP%\studio-remote-<name>.log`.
The pidfile next to the log is how `uninstall` finds the tree to kill — and it
verifies the pid's command line first, so a stale file can never shoot a recycled
pid.

Two deliberate settings:

- **`ExecutionTimeLimit` is zero** — Task Scheduler's default silently stops any
  task after 72 hours, which for a keep-alive service is a scheduled outage.
- **The trigger is at logon, not at boot**: a boot task needs stored credentials or
  session-0 acrobatics for processes that want the user profile (`code` lives in the
  user's PATH; the engine's VSTs want the interactive session anyway). The machine must
  auto-login or be logged in once; that is the shape of a dev box.

## The dev session — `npm run dev`, i.e. Tilt

Seventeen servers under one TUI process live and die together, with no way to
restart just one. The session therefore runs under **[Tilt](https://tilt.dev)**:
`npm run dev` is `tilt up --port 10350` (`scripts/dev.mjs`, which also refuses to
start a second session). Each dev server
is a `local_resource` with its own status, its own filterable logs, and its own
restart button in the web UI at `http://localhost:10350`. The tray task
(`k7-tray`, the engine + supervisor + tray rebuild loop) is a resource like the others, so a
broken engine build is a red row with readable logs instead of a dead session.

The `Tiltfile` derives the resource list by running `scripts/tilt-tasks.mjs` (a
package joins by having a `dev` script; the aggregators and the tsc
watchers are dropped — docs/dev.md's "The task list" says why), so a new app still
joins by existing. The root `build` and `test` scripts stay outside that list: Tilt only
owns the dev *session*.

The UI cannot live under a path prefix (its SPA loads `/static/*` absolute and `tilt up`
has no base-path flag), so it gets a **port** rather than a path, and `/dev-status`
redirects there as the memorable name. That redirect points at
`app.priv.k7.rocks:10351`, which answers nothing until the LAN proxy forwards that
port — locally the UI is `http://localhost:10350`. From a terminal,
`tilt trigger <resource>` does what the button does.

## The shared terminals — `console.priv.frediver.se`

The Tilt UI has no stdin. `scripts/console/server.mjs` is the terminal-shaped
companion: **PowerShell tabs in ConPTYs the service owns** (node-pty, the terminal
library VS Code is built on), served as an xterm.js page. Because the PTYs belong to
the service and not to any client, they survive every browser tab — which makes this
the home for `claude` sessions that must outlive the window that launched them — and
every viewer sees the *same* tabs and types into the *same* shells: ~1 MiB of
scrollback per tab is replayed to a joining client, then a one-row resize jiggle
repaints the screen. *Arrêter* writes `\x03` first and only hard-kills after 8 s; a
dead shell stays on screen with its exit code until someone presses *Relancer*;
closing a tab (×, confirmed) kills its shell for real. Twelve tabs at most — a
runaway “+” should not fork-bomb the machine. **Clicking the tab one is already on
renames it** — a mouse reads that as a double-click, a phone gets the same gesture
without a long-press; the name (24 chars, blank restores `id·shell`) lives with the
session, so it survives a *Relancer* and every viewer sees it. Each new tab picks
its flavor from the shells the server detected at startup — PowerShell, Git Bash —
via the selector beside “+”, on the right of the bar just before the transport
buttons (hidden when there is only one); all of them start in the **user's home**.
**Git Bash is the default** when present; builds stay on the Windows side under
Tilt either way.
`STUDIO_CONSOLE_CMD` overrides the default (tests use this).

One consequence of *shared* worth knowing: a tab has one size, and the last device
to attach or resize wins — a phone attaching to a desktop's tab rewraps it to phone
width until the desktop touches it again. On touch devices the page adds a
helper-key row (Esc, Tab, a sticky Ctrl that turns the next letter into its control
character, ^C, arrows) and follows the visual viewport, so the soft keyboard shrinks
the terminal instead of covering it.

## Why not ttyd (or gotty, wetty, tty-share)

ttyd is the obvious candidate: it spawns **a new process per client** and kills it on
disconnect — shared, surviving sessions are delegated to tmux, which does not exist
on native Windows. gotty is the same shape; wetty rides SSH; tty-share has no
Windows support; code-server means WSL here. What tmux provides on Linux — a PTY
that outlives and multiplexes its viewers — is exactly what `server.mjs` implements
with node-pty and xterm.js, the bricks VS Code itself is made of.

## Its dependencies stay out of the workspace

`scripts/console/package.json` is a package of its own, NOT a workspace, with its own lockfile.
node-pty ships prebuilt binaries for Windows and macOS only, so every Linux `npm ci` — CI, and each
image — would otherwise compile it from C++ for a console that runs on this Windows machine alone.
`npm run console` and `npm run remote:install` install it into `scripts/console/node_modules`.

## The name, and the one accepted beside it

`scripts/dev-hosts.mjs` holds them. `app.priv.k7.rocks` is k7's own origin; `docs.priv.k7.rocks`
is its documentation, served by the same dev server; `priv.st0.app` and its `play.` and `k7.`
aliases are the former dev hosts, whose pages k7 moves to the origin — exactly as production is
under `app.k7.rocks` / `docs.k7.rocks` / `st0.app`. Each resolves to the LAN server, which reverse-proxies to the matching dev server on
the workstation — see `docs/dev.md`'s table. A hostname lives in a router and in everyone's
bookmarks rather than in this repo, so it does not follow the apps.

`studio.test` stays in `EXTRA_HOSTS` for two reasons: a local Caddy may be running and answering
it on 127.0.0.1, and the reverse proxy may forward with `Host: studio.test` rather than the public
name. Vite rejects an unlisted Host outright, so dropping it while either holds answers
403 to every request instead of failing somewhere legible.

## Auth

`code.priv.frediver.se`, `console.priv.frediver.se` and the Tilt UI are **unauthenticated, on purpose**: a dev-only choice on
an open-source repo, acceptable because nothing here is reachable from outside the LAN.
The trust boundary IS the LAN: the proxy (traefik) lives on another machine, so the
console and the editor bind `0.0.0.0` — their ports answer any LAN peer, proxied or
not. A loopback bind answers the proxy "connection refused". The day any of it leaves
the dev network, the remedy is a forward-auth rule on the proxy pointed at k7's
backend, which owns `/auth` for the origin.

**The console's WebSocket checks the page's Origin**, because a browser lets any site it shows
open a socket to a LAN address: without the check, a page visited on a machine of the LAN could
type into these shells. Only `https://console.priv.frediver.se`, `localhost` / `127.0.0.1` /
`[::1]` on the console's own port, and the comma-separated origins in `STUDIO_CONSOLE_ORIGINS`
attach; any other socket, one with no Origin included, is closed with 1008
(`scripts/console/origin.mjs`). It guards browsers only: a LAN peer writes whatever Origin it likes.

Anyone who reaches the editor gets a shell on the dev machine, which is what makes this a
decision rather than an oversight. The editor keeps `--without-connection-token`: a token would
turn every first visit from a new browser into a hunt for the `?tkn=` URL in the task's output, and
the LAN boundary above is the one this workstation relies on. To put VS Code's own auth back, drop
`--without-connection-token` from `scripts/vscode.mjs` and add `--connection-token-file <path>`:
`serve-web` then trades a `?tkn=` query for a 7-day cookie.

## Reaching it from another machine

Nothing to do: `app.priv.k7.rocks` is a real name with a real certificate, so any
machine that can reach the LAN server just opens it. That is the whole reason a public
name is used here rather than an internal CA behind a `.test` one — a private CA has to
be installed on every machine, in Firefox's own certificate store as well as Windows',
node trusts it in neither, and a manually-accepted warning is not enough for WebSockets.
A backend calling another service still takes `SERVICE_PORTS` on localhost rather than
the public URL, for the reasons in [tokens.md](tokens.md).

## When something is wrong

```bash
npm run remote:status                     # task states + ports 8798 / 8797
tilt get uiresources                      # per-resource runtime status, from any terminal
tilt logs <resource>                      # one resource's log, from any terminal
Get-NetTCPConnection -LocalPort 10350     # who holds the Tilt port (the dev session)
```
