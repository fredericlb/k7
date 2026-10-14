# The built-in engine's settings

The desktop app runs a supervisor and its engine of its own (`docs/standalone.md`). The command-line
engine takes its machine's settings from a config file (`engine/st0-supervisor/engine.example.json`);
the app has no such file to hand the user, so st0's own pages reach this engine, through the app: the user
menu at the foot of the home sidebar has an **Engine** row, under Settings, opening
`/settings/engine` (`apps/st0/frontend/src/settings/DesktopEnginePage.tsx`).

## Through the main process, never a socket

The supervisor speaks NDJSON on its stdio to the process that started it, and opens no socket on
purpose (`engine/st0-supervisor/docs/hostProtocol.md`). The page therefore asks the app:
`src/engineBridge.ts` keeps the supervisor's latest snapshot, pushes it to every page of the app's
own origin, and forwards a page's command to the supervisor. The preload hands the page
`window.studioEngine` (`state`, `subscribe`, `send`); its absence is how st0 knows it is not in the
app, and the menu row is drawn only when it is there.

## Only the app's origin, only a few commands

A page of another origin could be loaded in a tab, so the main process answers only a page of the
app's own origin, and only `engine.start`, `engine.stop`, `engine.restart`, `audio.priority`,
`plugins.rescan` and `instruments.download` / `instruments.remove`. What else the supervisor takes —
the studios it is listed at, LAN pairing, plugin windows — is not reachable from a page: the app
chooses the studio itself (its own st0), and LAN pairing has its section in st0's settings.

## What the page sets

- **The engine:** running or why not, start, stop, restart.
- **Audio interfaces:** the ranking the supervisor keeps (`audioPriority`): the engine takes the
  first one plugged in. The list on screen IS the ranking, and every move sends it whole, as the
  config file's `audioPriority` holds it. A ranked interface that is unplugged keeps its row, since it holds its rank.
- **Plugins:** the engine's catalogue and a rescan. Read-only otherwise.
- **Downloads:** the sampled instruments the engine can play, each with the one action that fits —
  download, cancel while queued, retry after a failure, remove — and a progress bar while it runs.
  Nothing is fetched until asked for here (`engine/st0-supervisor/docs/instruments.md`):
  the list runs to gigabytes.

Sample rate and buffer size are not settings of the engine or the supervisor, so they are not here.
