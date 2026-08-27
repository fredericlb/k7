# Developing in WSL, with the engine and the tray on the host

The audio half of this repo cannot leave Windows: `engine/moteur` wants WASAPI/ASIO and
`engine/capot` hosts the machine's VSTs. Everything else is TypeScript and has no reason to
stay. So the sources live in the distro, on ext4, and Windows keeps exactly two jobs:
**compile C++ and Rust, and run the binaries that come out.**

One rule holds the whole arrangement up:

> **The share carries sources one way. Every write and every executable lives on NTFS.**

## What runs where

| | WSL (ext4) | Windows |
|---|---|---|
| the source tree | `~/studio` — **the only one** | a mirror, derived, never edited |
| npm | the one `node_modules` | the mirror's own, for the tray build |
| dev servers | vite, the four backends, Tilt | **the file service** — see below |
| moteur, capot | — | built and run, exactly as before |
| `~/.studio` | seen as `/mnt/c/Users/<you>/.studio` | its real place, read natively |
| console, VS Code web | — | the logon tasks of [remote.md](remote.md) |

The file service is the one dev server that crossed back. Everything else here reads its own
sources and talks over sockets; that one reads `~/.studio/root`, which stays on NTFS for the
engine's sake — so from the distro every `readdir` it makes is a 9p round trip.

## Why a mirror, and not a build over the share

The obvious arrangement is to point MSVC straight at `\\wsl.localhost\<distro>\...`. It
**works** — the engine configures, compiles and runs from there. It is also **never
incremental**, which for JUCE + Tracktion is the difference between a second and several
minutes:

```
MSB8064: the custom build for … succeeded, but the specified dependency
         "\\wsl.localhost\…\cmakelists.txt" does not exist.
```

Note the case. MSBuild lowercases the dependency it tracks, ext4 is case-sensitive, and the
file it then looks for is not there — so nothing is ever up to date and every rebuild
recompiles everything. Measured both ways on the same probe: source on the share, an untouched
rebuild recompiles; source on NTFS, it does not. For an engine whose half-rebuilt state links
fine and crashes later (`engine/moteur/AGENTS.md`), an unreliable up-to-date check is worse
than a slow one.

So the sources are **copied** to NTFS and built there. It costs almost nothing: the whole tree
mirrors cold in about 9 s and warm in about 0.5 s, and `engine/` alone — the loop's real job —
in about 30 ms.

## The bridge

`scripts/dev-native-bridge.mjs` is the native task under WSL. `scripts/dev-native.mjs` hands
over to it when `$STUDIO_NATIVE_MIRROR` is set and the platform is not Windows, and the bridge
then runs **that same script, unchanged, on the host**, over the mirror. So the whole native
half keeps the shape [dev.md](dev.md) describes — one process owning both watches, stop → build
→ start — and the Tilt row, its logs and its restart button stay where they were.

What crosses, and what does not:

- **`/MIR`, one way.** The mirror is derived. Editing it is editing something that the next
  pass will overwrite.
- **Skipped**: `node_modules` (the mirror keeps its own, installed once — the tray build needs
  esbuild and the Tauri CLI on the host), `.git`, `build`, `target`, `out`, `.turbo`, `.vite`,
  `.claude`.
- **`dist` is NOT skipped.** `engine/capot/dist/index.html` is tracked by git: it is the tray's
  web assets, not build output, and Tauri stops with *"Unable to find your web assets"* without
  it. It is the one directory here whose name says output and whose content is source.
- **Each caller names the subtrees its loop covers.** A whole-tree pass every second would spend
  half of it walking directories. The native task watches `engine/` alone, since the TypeScript
  it would carry is bundled into the tray at startup rather than mid-session; the file service
  below watches `packages/` and `commons/`, which it re-reads at every restart.

Robocopy answers a bitmask, and only bit 1 means something was copied; bit 2 is "extras at the
destination", which the skipped build output sets on *every* pass. Testing the wrong bit makes
the bridge announce a copy every 700 ms forever.

**It copies on TIMESTAMP, not on content**, and that has a consequence worth knowing before it
surprises you: anything that rewrites files without changing them — a branch checkout, a restore
from another tree — travels to the mirror as a wholesale rewrite. CMake reads mtimes, so
`CMakeLists.txt` coming back byte-identical but newer is enough to re-run configure, and a
re-generated FetchContent subbuild has no record of its earlier clone: it re-downloads Tracktion,
1.7 GB, for a file that did not change. The build is not wrong, only slow. And if the previous
engine is still letting go of its files, the re-populate first fails on `Error removing directory
… _deps/tracktion_engine-src`, which reads like a permissions problem and is contention — retry
once nothing holds it.

## The file service runs on the host too

`scripts/dev-file-service.mjs` hands over to the same bridge, and for a measured reason. st0's
home page polls `/workspaces/projects` every 3 s; that answer comes from `projectDirsUnder`, a
recursive `readdirSync` over every workspace — 1394 directories here. On NTFS, natively, the
whole walk costs **1.3 ms**. From the distro, through 9p, it costs **3.6 to 5.5 s**, which is
longer than the 5 s window the listing is cached for. So the service re-walked continuously,
its event loop was blocked ~80 % of the time, and every other request queued behind it: a
`by-repo` or a `/health` took 8 to 16 seconds and the browser gave up first. Nothing was
unreachable — it was starved.

This is not a workaround, it is dev catching up with production: on a musician's Windows
machine the tray spawns a **native** file service, and the WSL one was the odd version out.

Three things this arrangement had to get right, each of which cost a debugging round:

- **The watcher is the bridge's, not tsx's.** `tsx watch` on the host announces `Restarting…`,
  starts the replacement before the old process lets go of 8770, and the new one dies on
  `EADDRINUSE` — *while the old one keeps serving*. A save then looks applied and is not. So the
  host runs `npm start`, with no watcher, and a mirror pass that copied something restarts it.
- **Stopping means the port is bindable, not that netstat is quiet.**
  `scripts/stop-host-port.mjs` kills the listener's tree with `taskkill /T /F` — an interop kill
  reaches `cmd.exe` and leaves the node under it holding the socket — then *probes the port by
  binding it* until that succeeds. Windows drops the netstat row well before it lets go.
- **The host's output is piped through the bridge, not inherited.** Two pipes into one Tilt pane
  arrive out of order, which is enough to hide which of two processes died first.

`launch()` clears the port before every start, restart included, so an orphan from a previous
session is adopted away rather than fought. That matters: a stale `tsx watch` on the host keeps
watching, and every one of them restarts *its own* server on the next save, all of them racing
for 8770. If a save ever stops taking effect, look for those first:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*server.ts*" }
```

## The two things the code had to learn

**One spelling of `~/.studio`.** It had three — `studioDir()` in
`packages/engine-client/src/paths.ts`, `EXTS_PATH` in `packages/song/src/engineCatalogue.ts`,
and `packages/song/src/mediatekRoot.ts` — each joining `homedir()` itself. They now all go
through `studioHome()` (`packages/song/src/studioHome.ts`), which honours **`$STUDIO_HOME`**.
It sits in song rather than engine-client because engine-client imports song and never the
reverse. Moving one of the three and not the others would have been exactly the silent
divergence `paths.ts`'s own header warns about: a wrong path there does not throw, it reads as
an empty file.

The directory itself stays on NTFS, where the engine reads its wav files at full speed. The WSL
side sees it through `/mnt/c`.

**A path map at the wire.** A `ProjectDoc` carries absolute paths
(`packages/engine-protocol/project.ts`), and `/mnt/c/x` here is `C:\x` there. A path the engine
cannot open does not raise: it plays as silence. `packages/engine-client/src/enginePaths.ts`
maps between the two spellings and is applied at `engineControl.ts`'s **one** `send()` and
**one** `ws.on("message")` — both of which the file already called the single choke point.

It is applied in **both** directions on purpose. `snapshotPluginBase` in
`packages/file-service/src/engineLink.ts` sends a path and matches it against the one the engine
echoes back; a map applied only outbound would break that comparison silently. Round-tripping
is what keeps it honest, and it is what the tests in `enginePaths.test.ts` pin.

The `state` frame is exempt: it arrives at meter rate and carries no path.

Both knobs are off unless set, so nothing changes for macOS, for CI, or in production.

**And the file service, on the host, must have neither.** It spells paths the way the engine
does, so a map there would rewrite `C:\x` into `/mnt/c/x` on the way in and name files nothing
can open. It gets this right because WSL interop passes only what `$WSLENV` lists, and neither
`STUDIO_ENGINE_PATH_STYLE` nor `STUDIO_HOME` is on it — which is worth knowing before adding
one of them to `WSLENV` for some other reason.

## Setting it up

Copy the tree — do **not** clone it. `commons/`'s pinned commit is local-only, so a fresh clone
cannot initialise the submodule, and a clone would drop the working tree's uncommitted changes:

```bash
mkdir -p ~/studio && cd /mnt/c/Users/<you>/Src/studio
tar -cf - --exclude='*/node_modules' --exclude='*/.claude/worktrees' \
          --exclude='*/engine/moteur/build' --exclude='*/engine/capot/src-tauri/target' . \
  | (cd ~/studio && tar -xf -)
cd ~/studio && npm ci
```

Then, once, on the Windows side: `npm ci` in the mirror (`C:\studio-native` by default), so the
tray build finds esbuild and the Tauri CLI — and so the file service finds tsx and everything it
imports, that install being its `node_modules` too. Redo it there whenever a dependency changes:
the mirror carries sources one way and never `node_modules`, so nothing else will. After that,
`npm run dev` from the distro is the
whole story — `scripts/dev.mjs` derives `STUDIO_NATIVE_SOURCE`, `STUDIO_NATIVE_MIRROR`,
`STUDIO_ENGINE_PATH_STYLE` and `STUDIO_HOME` from `$WSL_DISTRO_NAME` and `wslpath`, rather than
leaving four addresses to be typed into a shell profile. Every one stays overridable.

`.wslconfig` needs `networkingMode=mirrored`, which makes localhost the same on both sides —
without it the supervisor cannot reach a backend and the file service cannot reach the engine.

**And mirrored networking adds a firewall the host side never had.** The distro then shares the
host's addresses, so a dev server binds the right one — but inbound traffic to it is governed by
the **Hyper-V firewall**, whose default for the WSL VM is `Block`. Loopback still works, which is
what makes this hard to see: `curl http://127.0.0.1:5223` answers 200 from Windows while the LAN
proxy, coming from another machine, times out. A **504 from `st0.priv.frediver.se` with every Tilt
resource green** is this and nothing else. Once, elevated:

```powershell
New-NetFirewallHyperVRule -Name 'studio-dev' -DisplayName 'studio dev servers (WSL)' `
  -Direction Inbound -Action Allow -Protocol TCP -Enabled True `
  -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' `
  -LocalPorts 3001,3002,3003,3004,3005,3006,5173,5223,5224,8080,8770,8787,8789,8795
```

That list is [dev.md](dev.md)'s proxy table, plus **8770** — the file service, which the browser
reaches directly rather than through the proxy. It is the one port there that no proxy rule names,
so it is the one a reader drops. The engine's own 8765 is absent on purpose: it is a native Windows
process and this firewall does not apply to it.

The blunter alternative is `Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-…}'
-DefaultInboundAction Allow`, which opens whatever the distro happens to listen on. It matches what
[remote.md](remote.md) already says out loud — the trust boundary IS the LAN — and it does not rot
when an app joins. The rule above is narrower and will need editing the day a port is added; that
is the trade.

## `/mnt/c` needs `metadata`, or git over SSH never answers

`packages/git-repos/src/keys.ts` writes the workspace's deploy key with `mode: 0o600` and
chmods it again afterwards. On drvfs **both calls are silent no-ops**: without the `metadata`
mount option every file under `/mnt/c` reads as `0777`, and a mode cannot be stored at all. So
the key the code believes it protected is world-readable, OpenSSH refuses to load it —

```
Permissions 0777 for '…/id_ed25519' are too open. This private key will be ignored.
```

— and git falls back to asking for a password. There is no tty behind a file service, so it
waits. The symptom is `POST /open` never answering, because `ensureLibraries` runs git before
anything else: no error, no log line, just a request that hangs. Add to `/etc/wsl.conf`:

```ini
[automount]
options = "metadata"
```

then `wsl --shutdown` from Windows — which ends the dev session, any SSH session into the distro
and a VS Code server running there, so pick the moment. `sudo mount -o remount,metadata /mnt/c`
does it without the shutdown when it takes. Either way the key already on disk keeps its old
mode until someone fixes it: `chmod 600 /mnt/c/Users/<you>/.studio/ssh/*/id_ed25519`.

## What the move turns up

ext4 is case-sensitive and NTFS is not, and POSIX paths split differently from Windows ones.
Expect the first run to find real bugs rather than porting problems — the first one it found
was `librariesFamilyRoot` in `packages/song/src/sharedFolders.ts`, rebuilding a path with
`join(...segs)` where a POSIX path's leading `""` had already been dropped, so the result came
back relative and every chain template inside the library saw no catalogue. On Windows the
first segment is `C:` and the bug could not show.

Watching is the other difference, and it is a gain: sources on ext4 fire inotify, so `poll` in
the vite configs (`apps/st0/frontend/vite.config.ts` and the two beside it) is now
`$STUDIO_POLL` rather than a hardcoded `true`. Set it only for a tree read over `/mnt/c`, where
inotify is mute.

## The shells

The console and VS Code web stay Windows logon tasks — [remote.md](remote.md) is unchanged in
shape. `scripts/console/server.mjs` gained one tab flavour, `wsl`, and prefers it when a distro
answers: that is where the tree and every npm command now live. Git Bash and PowerShell are
still one selector away, and the native toolchain is reachable from a WSL tab anyway, interop
passing a usable `PATH` — `node`, `npm` and `cmake` all resolve.
