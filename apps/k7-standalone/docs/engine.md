# The built-in engine's settings

The desktop app runs a supervisor and its engine of its own (`docs/standalone.md`). The command-line
engine takes its machine's settings from a config file (`engine/k7-supervisor/engine.example.json`);
the app has no such file to hand the user, so k7's own pages reach this engine, through the app: the user
menu at the foot of the home sidebar has an **Engine** row, under Settings, opening
`/settings/engine` (`apps/k7/frontend/src/settings/DesktopEnginePage.tsx`).

## Through the main process, never a socket

The supervisor speaks NDJSON on its stdio to the process that started it, and opens no socket on
purpose (`engine/k7-supervisor/docs/hostProtocol.md`). The page therefore asks the app:
`src/engineBridge.ts` keeps the supervisor's latest snapshot, pushes it to every page of the app's
own origin, and forwards a page's command to the supervisor. The preload hands the page
`window.studioEngine` (`state`, `subscribe`, `send`); its absence is how k7 knows it is not in the
app, and the menu row is drawn only when it is there.

## Only the app's origin, only a few commands

A page of another origin could be loaded in a tab, so the main process answers only a page of the
app's own origin, and only `engine.start`, `engine.stop`, `engine.restart`, `audio.priority`,
`plugins.rescan` and `instruments.download` / `instruments.remove`. What else the supervisor takes —
the studios it is listed at, LAN pairing, plugin windows — is not reachable from a page: the app
chooses the studio itself (its own k7), and LAN pairing has its section in k7's settings.

## Reached from the LAN only

This engine is listed at the app's own backend and nowhere else: every start sets `registryUrls`
in its `engine-host.json` back to that one loopback registry, whatever an older build or a hand
edit left there. Listed at a hosted studio, it would hold a tunnel to it, and anyone the studio
lets drive it could reach the machine from anywhere. A device on the same network drives it on its
own port once paired (`engine/k7-runtime/docs/pairing.md`); the phone and the command-line engine
are the ones that join a hosted studio.

## The folders it may open

The engine opens only the files under its roots (`engine/k7-runtime/docs/pathRoots.md`), and its
state folder is `engine-home/`. A project from this app's own backend is not copied there: the
engine is on the same machine and is sent the backend's own paths — the account's workspace, the
libraries beside it, the médiathèque. So every start hands the supervisor `workspaces/` and
`mediatek/` as `$STUDIO_ENGINE_ROOTS`, which the engine inherits. Without them the engine drops
every clip, rack sample, Surge patch, amp model, IR and preset the project names, and still plays:
a silent track, a kit with no pads, a synth on its init patch.

## What the page sets

- **The engine:** running or why not, start, stop, restart.
- **Audio interfaces:** the ranking the supervisor keeps (`audioPriority`): the engine takes the
  first one plugged in. The list on screen IS the ranking, and every move sends it whole, as the
  config file's `audioPriority` holds it. A ranked interface that is unplugged keeps its row, since it holds its rank.
  The one the engine is on wears a badge beside its name with the channels it opened (the
  supervisor relays the engine's counts): "2 in · 2 out" on an interface that has sixteen inputs
  is the tell that it is reached through the wrong backend. When the engine is on a Windows
  shared endpoint while an ASIO driver is listed, a line above the list says so and puts the
  driver first in one click — with no ranking the engine picks the shared endpoint on purpose
  (`engine/k7-runtime/docs/audioDevice.md`), so nothing else would.
- **Plugins:** the engine's catalogue and a rescan. Read-only otherwise.
- **Downloads:** the sampled instruments the engine can play, each with the one action that fits —
  download, cancel while queued, retry after a failure, remove — and a progress bar while it runs.
  Nothing is fetched until asked for here (`engine/k7-supervisor/docs/instruments.md`):
  the list runs to gigabytes.

Sample rate and buffer size are not settings of the engine or the supervisor, so they are not here.
