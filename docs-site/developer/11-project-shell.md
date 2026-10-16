# project-shell: what an app needs before it can draw

`packages/project-shell` (`@studio/project-shell`) is what any app that opens a project needs before drawing anything: the launch address, the file-service transport, the gate that opens the project, idle handling, undo, and the app's own confirm and toast. k7 mounts it, and z0's editor consumes it from another repository as a **published** package, which is why it has a version and a `files` list and why it may only depend on `@studio/web-protocol` (everything else is a peer).

## Exports

| Subpath | File | Holds |
|---|---|---|
| `./launch` | `packages/project-shell/src/launch.ts` | Re-exports of the address parsing in `packages/web-protocol/projects.ts` (`parseLaunch`, `parseExternal`, `externalUrl`, `isExternalIndex`, `projectBasename`, `launchUrl`…) plus `projectsUrl`. The parsing lives in web-protocol because k7's home page writes these addresses and both editors read them. |
| `./fileApi` | `packages/project-shell/src/fileApi.ts` | The transport to the file service: `configureFileApi`, `fget`, `fsend`, `fileHeaders`, `mediaUrl`. |
| `./files` | `packages/project-shell/src/files.ts` | Routes that need no compiled view: open, bench, tree, read, write, fmt, folder, rename, move, delete, sync state, engine unload. |
| `./project` | `packages/project-shell/src/project.ts` | `projectApi`: the shared routes plus the compiled-project ones (commands, completion, undo/redo, preferences, vim). k7's `api.ts` spreads it. |
| `./gate` | `packages/project-shell/src/ProjectGate.tsx` | The gate component. |
| `./idle` | `packages/project-shell/src/idle.ts` | Idle detection and the sleep rule. |
| `./undo` | `packages/project-shell/src/undo.ts` | `runUndo` / `runRedo`. |
| `./ask`, `./toast` | `src/ask.tsx`, `src/toast.tsx` | The app's own confirm/prompt (replacing the OS box, which ignored the Escape ladder) and toasts. |
| `./profiling` | `src/profiling.ts` | `PROFILING`, on with `?profile=1` or `studio.profile` in localStorage. |

## The file transport

`configureFileApi` is called **once**, by the gate, with the file hub's base URL, the workspace, and a ticket `<ticket>~<engineId>`. Every request carries the user, workspace and token headers; the cookie is never used, because the file service only trusts the hub.

`fget` shares identical GETs in flight (keyed by path and a write epoch) but is not a cache: every route answers from disk now, with `cache: "no-store"`. A read has a 120 s timeout, is retried once when its body breaks off (the service was restarting), and renews an expired hub ticket once on a 401 through the `renewTicket` callback. JSON parsing is timed through an injectable `Tally` (`setFileApiTally`) so k7's freeze watchdog can see it.

A **frozen** config (a share) answers canned responses and makes writes throw with a reason: that is the whole of read-only mode.

## The gate

`ProjectGate` resolves the address into a project and walks through phases:

| Phase | Shown |
|---|---|
| `resolving` | spinner |
| `cloning` | the bench being built |
| `syncing` | the project still arriving from the relay (`src/syncWait.tsx`); `/open` refuses until it is complete |
| `loading` | the project on its way to the engine: copied, applied, warmed (`src/EngineLoadScreen.tsx`) |
| `open` | the app (`children`) |
| `missing` | the project is not in the workspace; no Retry |
| `no-libraries` | the origin has no library; the host renders its own card (`renderNoLibraries`) |
| `empty` | the workspace holds no project; the host renders its wizard (`renderEmpty`) |
| `idle` | the session went to sleep |
| `error` | with a fault classification (refused origin vs. dead service) |

Only `@local/<workspace>/<project>` and `@banc` addresses resolve; an older two-segment address is refused rather than guessed. The gate takes all its wording through `strings`, since each app owns its language.

## Idle

`useIdleTimeout` stamps a module-level "last active" time on pointer, key, wheel and touch events (and `markActive()` for what no event reports, such as playback) and checks it every 15 s — a timestamp rather than a restarted timer, so a machine waking from sleep tells the truth. k7 passes `IDLE_TIMEOUT_MS` (20 minutes). Tabs of the same origin tell each other when they were last used over a `BroadcastChannel`, so a forgotten tab does not unload a session another tab is using.

`sleepMove` is the shared rule: an open project goes to sleep when out of sight (a background desktop tab) or idle; only a `hidden` sleep wakes by itself. Going to sleep unloads the engine; the host app is told through `onIdle` / `onResume` because k7's engine lease belongs to the gate above.

## Undo

`runUndo` / `runRedo` call the file service's journal, ask `confirmProcess` before a step that restores a bounced audio file, open the first file the step changed and notify. Each app supplies those effects through `HistoryDeps`.

## Tests

`npm run test` in `packages/project-shell`: launch parsing, the transport's retry and sharing, idle, command and completion routes.
