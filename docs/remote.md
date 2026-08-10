# Remote — keeping a hand on the machine when the dev session dies

Working on the studio from elsewhere used to hang on one thread: the browser editor
at `/dev` was a task **inside** `npm run dev`. If turbo crashed, the editor died with
it — the only door closed exactly when you needed it. The fix is an inversion: three
services that come up with the machine and survive independently of each other,
installed as Windows logon tasks by `scripts/remote.mjs` — and the dev session
itself run by an orchestrator with a web UI, so "see what broke and restart it" is a
button in a browser, not a terminal you no longer have.

The way in is no longer one of them. `https://st0.priv.frediver.se` resolves to the
**LAN server**, which reverse-proxies to these ports; nothing this workstation starts
terminates TLS any more, so the door stays open even when everything below has crashed.
That is strictly better than the local Caddy it replaced, which was itself a logon task
and could take the door down with it.

| what | where | task |
|---|---|---|
| the browser editor | `/dev` | `studio-vscode` |
| the dev session, per-task | `https://studio.test:10351` (Tilt UI — the one thing still on the old name; `/dev-status` redirects to the new one, which does not answer on that port) | `studio-tilt` |
| a shared shell | `/console` | `studio-console` |

## The logon tasks

```bash
npm run remote:install     # register the three tasks + start them
npm run remote:status      # task states + who is actually serving
npm run remote:uninstall   # unregister and stop them
```

They are launched through `scripts/hidden.vbs` so a boot does not open three console
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
  session-0 acrobatics for processes that want the user profile (`code` and `tilt`
  live in the user's PATH; the tray's VSTs want the interactive session anyway).
  The machine must auto-login or be logged in once; that is the shape of a dev box.

## The dev session — Tilt

`turbo run dev` is one process: seventeen servers live and die together, and the
TUI cannot restart one of them. The session therefore runs under
**[Tilt](https://tilt.dev)** (`tilt up`, the `studio-tilt` task): each dev server is
a `local_resource` with its own status, its own filterable logs, and its own restart
button in the web UI at `https://st0.priv.frediver.se:10351`. The native monitor
(`dev:native`, the moteur + tray rebuild loop) is a resource like the others, so a
broken engine build is a red row with readable logs instead of a dead session.

The `Tiltfile` derives the resource list by running `scripts/tilt-tasks.mjs` — the
same rules as `scripts/dev.mjs` (a package joins by having a `dev` script; the tray,
the aggregators and the tsc watchers are dropped for dev.mjs's stated reasons) — so
a new app still joins by existing. turbo keeps `build` and `test`: Tilt only
replaces the dev *session*. `npm run dev` (the turbo TUI) still works for a local
terminal, but not beside a running Tilt: one session at a time, and
`remote:install` refuses to start `studio-tilt` while port 5224 (st0's vite) shows
one already running by hand.

The UI cannot live under a path prefix (its SPA loads `/static/*` absolute and `tilt up`
has no base-path flag), so it gets a **port** rather than a path, and `/dev-status`
redirects there as the memorable name. That redirect currently points at
`st0.priv.frediver.se:10351`, which does not answer — the UI is still only at
`https://studio.test:10351`, the last thing the move has not carried over. From a
terminal, `tilt trigger <resource>` does what the button does.

## The shared terminals — `/console`

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
its flavor from the shells the server detected at startup — PowerShell, Git Bash,
WSL — via the selector beside “+”, on the right of the bar just before the transport
buttons (hidden when there is only one); all of them start in the repo
(wsl sees it as `/mnt/…`, and a wsl with no distro prints its own error). **WSL is
the default** when present: editing (claude, nvim) lives there, while builds stay
on the Windows side under Tilt.
`STUDIO_CONSOLE_CMD` overrides the default (tests use this).

One consequence of *shared* worth knowing: a tab has one size, and the last device
to attach or resize wins — a phone attaching to a desktop's tab rewraps it to phone
width until the desktop touches it again. On touch devices the page adds a
helper-key row (Esc, Tab, a sticky Ctrl that turns the next letter into its control
character, ^C, arrows) and follows the visual viewport, so the soft keyboard shrinks
the terminal instead of covering it.

## Why not ttyd (or gotty, wetty, tty-share)

ttyd was evaluated first: it spawns **a new process per client** and kills it on
disconnect — shared, surviving sessions are delegated to tmux, which does not exist
on native Windows. gotty is the same shape; wetty rides SSH; tty-share has no
Windows support; code-server means WSL here. What tmux provides on Linux — a PTY
that outlives and multiplexes its viewers — is exactly what `server.mjs` implements
with node-pty and xterm.js, the bricks VS Code itself is made of.

## Auth

`/dev`, `/console` and `:10351` are **unauthenticated, on purpose**: a dev-only choice on
an open-source repo, acceptable because the proxy is reachable only from the LAN, and
nowhere else. Everything binds `127.0.0.1`, so the proxy is the only way in. The day any
of it leaves the dev network, the remedy is a forward-auth rule on the proxy pointed at
st0's backend, which owns `/auth` for the origin.

## Reaching it from another machine

Nothing to do: `st0.priv.frediver.se` is a real name with a real certificate, so any
machine that can reach the LAN server just opens it.

This is the whole reason the move happened, and the list it replaces is worth keeping as
a warning about what a `.test` name behind an internal CA costs. Every machine needed
`192.168.x.x studio.test` in its own hosts file **and** Caddy's root CA
(`%APPDATA%\Caddy\pki\authorities\local\root.crt`) installed — in Firefox's OWN
certificate store, which ignores Windows'. A manually-accepted certificate warning was
NOT enough for WebSockets. Nor was HTTP/3: browsers that negotiated QUIC lost their
WebSockets (pages fine, `ws` dead), so the Caddy config stripped `Alt-Svc`, and a browser
that had cached the old advertisement clung to h3 until a full restart. Node never trusted
that CA at all, which is why a backend calling another service still uses `SERVICE_PORTS`
on localhost rather than the public URL.

## When something is wrong

```bash
npm run remote:status                     # task states + ports 2019 / 8798 / 10350 / 8797
Get-Content $env:TEMP\studio-remote-tilt.log -Tail 50
tilt get uiresources                      # per-resource runtime status, from any terminal
Get-NetTCPConnection -LocalPort 10350     # who holds the Tilt port
```
