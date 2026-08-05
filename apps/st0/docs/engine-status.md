# The engine page — the tray's options, in the browser

`/engine` (cog menu → « État du moteur ») shows the chosen engine's state and offers
the tray's engine actions from any browser. It exists because the tray lives on the
engine's machine and the médiathèque does not: working remotely, the tray's menu is
exactly the panel you cannot reach.

## What talks to what

The page holds **one WebSocket to the engine itself** (`EnginePage.tsx`, via
`@studio/engine-browser`) and calls **the machine's file service** for the two
facts that live beside the engine rather than in it. It never goes through st0's
backend: the backend is hosted, and every fact here is per-machine.

The one-socket-per-tab rule (`useEngineChoice.ts`) holds because this section
replaces the module editor on screen — `useModuleEngine` is not mounted while the
page is.

## Tray ↔ page mapping

| tray item | page | how |
|---|---|---|
| status line (running · id · port) | « Moteur » card | probe + socket state |
| `Sessions ▸` + drop | « Sessions » card | `list-sessions` / `drop-session`, polled like the tray (2.5 s) |
| `Audio interface ▸` select | « Interface audio » card | `list-audio-devices` / `set-audio-device` |
| `Plugins: n` + `Rescan plugins` | « Plugins » card | `list-plugins` / `rescan-plugins` — **incremental**: the full rescan deletes the engine machine's `exts.json` first, which only the supervisor can do |
| `Native plugin UI ▸` | « UI native » card | `list-edit-plugins` / `show-native-plugin-ui` — the window opens on the engine machine's screen |
| `Clear waveform cache` | « Maintenance » | `POST <fileBase>/waveforms/clear`, the same route the supervisor calls |
| `Show logs` | « Maintenance » → Journal | `GET <fileBase>/logs?tail=300` — the merged log, read instead of opened |
| `Start/Stop/Restart engine`, `Restart file service` | **absent, on purpose** | the supervisor's only client is the stdio peer that spawned it; it has no network surface, and that is a security stance, not a gap (see engine-host) |
| audio preferred/fallback, web origins, autostart, folders | absent | supervisor/OS policy, same reason |

The wire verbs come from `@studio/engine-browser`'s `EngineClient`, which grew the
control queries (`listSessions`, `listAudioDevices`, `setAudioDevice`,
`listPlugins`, `rescanPlugins`, `listEditPlugins`, and a `session` override on
`showNativePluginUI`) so l8 or m9 can draw the same panel without re-stating the
wire.

## Routing

`engine` is a `SECTION_IDS` entry with no header tab: only the cog links to it,
and `routes.test.ts` pins both the round-trip and the no-collision rule
(`/console` and `/dev-status` joined the paths Caddy claims above st0).
