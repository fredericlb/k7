# The tray app

## Names, and the ones a rename may not touch

The binary and the displayed name are `st0-tray`; the engine it supervises is
`st0-engine`. That covers the npm package, electron-builder's `productName`, the tray tooltip,
the Quit item and the dialog titles — all build artifacts, which the next build replaces, so
they rename in one commit.

**`org.parapluie.studio.engine-tray`, the bundle identifier, does not.** On macOS this is the
app's *identity*: changing it makes the OS treat the build as a different application, dropping
its microphone and automation (TCC) grants and its login item while leaving the old one
registered. It is frozen in `electron-builder.cjs`, and its own migration if it ever moves.

Neither does anything the user's DISK remembers: `<state>` and what is under it, the `STUDIO_*`
environment variables, and `x-studio-engine-token`. Renaming one of those without a migration
discards a person's settings and reads as a first launch — see
`packages/engine-client/docs/paths.md` and `docs/rename-test-plan.md`.

The pattern: a *build artifact* can be renamed in one commit. A name the user's disk or the OS
remembers cannot.

---

`st0-tray` is an Electron tray app that starts with no window. It is the **VIEW** over the
supervisor (`engine/st0-supervisor`), which it spawns as a child and drives over NDJSON on
stdio: the supervisor owns the `~/.st0` contract, the registry and the engine. No file service
runs on this machine — workspaces live on the server (`packages/file-hub/docs/fileHub.md`). The tray renders its snapshots and sends its clicks back.

Nothing in `src/` opens a socket or reads a state file, and the one process it spawns is the
supervisor. What to allow, which engine is running, what the ports are, where to heartbeat: all of
it comes down in a snapshot, and a click goes back up as a command.

## Why Electron

Every desktop surface of studio renders in one engine, Chromium, and this one shares its shell
with `apps/st0-standalone` (`commons/packages/electron-shell/docs/shell.md`) — the supervisor driver
included (`packages/supervisor-host/docs/supervisorHost.md`). A tray in the system's web view would be a second engine to test the settings page
against: WebKit on macOS, WebKitGTK on Linux. The cost is size: Electron adds about 300 MB unpacked
to the ~100 MB of engine, supervisor and libraries, and a windowless Electron sits around
60–100 MB of memory all day.

## The microphone is the tray's to ask for

On macOS the microphone grant belongs to the RESPONSIBLE app: the engine records through the
supervisor the tray launched, so it is the tray that asks, and the tray that `System Settings ›
Privacy › Microphone` lists. Its Info.plist carries `NSMicrophoneUsageDescription` for that
reason, set in `electron-builder.cjs`. An app without one is never asked: macOS hands it silence, the take is written, its
file is all zeros and the input meter reads -100 dB, which looks like a dead cable rather than a
refusal. The grant is keyed on the bundle identifier, the other reason that identifier is frozen.

## Nothing to install beside it

The tray probes for no CLI at startup. Workspaces live on the server and reach a device through the
live-sync relay, and what this machine plays arrives as files through the tunnel
(`packages/engine-tunnel/docs/tunnel.md`). A probe here would refuse a machine for a tool it never runs.

## The settings window

One window, `src/settingsWindow.ts`, holding what a MACHINE is set to rather than what a
project is. Seven tabs, because they answer seven different questions and only one of them is
ever urgent:

| tab | what it is |
|---|---|
| Audio | the interface ranking, as a list you drag |
| Plugins | the installed catalogue, filtered, and the rescan that refills it |
| Sessions | what this engine is holding, and the plugin editors it can open |
| st0 instances | which st0 instances this engine is connected to, and a form to add one |
| Downloads | the sampled instruments this machine keeps: download, cancel, retry, remove |
| Paired devices | the LAN devices asking to drive this engine, and the ones it trusts |
| System | version, engine, registry — and every button that acts on them |

**The menu bar keeps one line and no buttons.** A status line is what a menu bar is for; a
ranking, a catalogue of several hundred rows, a list of live sessions and a row of destructive
buttons are not, and they belong in a window. `Settings…` is the way in, and the only one — the
tray draws no device, count, session, version or web UI anywhere. The one exception is a
download in progress (`engine/st0-supervisor/docs/instruments.md`): a second line, there only while
it lasts, because a machine fetching 750 MB of piano has to say so where someone looks before
playing. A blocked origin still raises the icon's attention dot and a
banner; both point at the st0 instances tab.

It is hidden on close, never destroyed, and nothing opens it until someone asks.

The page is hand-written HTML, CSS and JS under `settings/`, loaded from disk. The tray has no
frontend build and gains none for seven tabs: three classic scripts, and `window.st0Tray` — an
`invoke` and a `listen` — is all they reach the main process through. The main process answers
only the settings window's own `webContents`. The window draws only what a snapshot said and sends
back only commands, so the rule that **the tray computes no policy** holds here too.

On macOS the app stays an accessory — no Dock icon and no app-switcher entry — so the window
comes forward on focus and leaves nothing behind when it hides.

### Audio — the list IS the ranking

The supervisor keeps an ORDER, not a chosen device: the first name in it that is actually
present is where the engine goes (`engine/st0-supervisor/docs/supervisorPolicy.md`, *Why a list,
and not a pick plus a fallback*). `audio.priority` carries the WHOLE ranking in one command,
because a reorder is a single act and two halves of it could interleave with a poll. That
command's argument is simply what is on screen: the ranking, then every other interface plugged
in, and a drop commits all of it — which is how one move ranks a machine that had ranked nothing.

**A ranked name with no device behind it keeps its row, in red.** It is what holds the rank while
the interface is unplugged, so replugging restores it; drop the row and the order silently
reshuffles under a user who never asked it to. The colour is the answer to *why is my engine not
on my interface* — the one question this list exists to answer — and that row is the only one
carrying a **Forget** button, because dropping one name is the one thing dragging cannot say.

A snapshot arriving mid-drag is dropped rather than drawn: redrawing would pull the list out from
under the pointer. The other two tabs redraw regardless — nothing there is under a finger.

### Plugins — read-only, and rescanned from here

The catalogue rides the snapshot like every other list, gated on `pluginsSig`
(`engine/st0-supervisor/docs/hostProtocol.md` weighs what that costs). What the engine answers is
already the full list — the count was only ever `.length` of it — so nothing extra is asked of the
engine to draw this.

The list is read-only, deliberately: this is the INSTALLED catalogue, and everything you can do to
a plugin you do to an instance of it in a project, which is st0's business rather than the tray's.
The filter is there because a working machine has hundreds of rows.

### st0 instances — none until you add one

A fresh machine is connected to **no** st0 instance, and nothing is suggested: the supervisor has no
default registry, seeds no origin, and ignores the local backends' `web-endpoints/` advertisements —
running `npm run dev` connects nothing either (`engine/st0-supervisor/docs/supervisorPolicy.md`). This tab is
where one is added — its address typed into the form, and nowhere else.

Each row is one instance as the supervisor's `instances` reports it: the registries this engine
heartbeats to, keyed by studio family and shown as st0's origin, because to the user those are the
same thing. Adding sends `weburi.add`, and the engine heartbeats to the family's one registry, st0's backend's,
which is where st0's picker reads too. Typing `st0.app` or its alias `play.st0.app` connects the same instance.
**Remove** sends `weburi.remove`, which deregisters at once. A registry that came from
`$STUDIO_REGISTRY_URL` gets no Remove and says why: the environment is not the tray's to edit.

The address is checked here only to answer at once — `ftp:// is not a web
address`, `already connected to …` — and reduced to the origin before it is sent. The supervisor's
`normaliseUserOrigin` is the gate. A bare host gets `https://`, as it does there.

Then the supervisor **asks** the instance's registry whether it is one, before anything is written:
an added instance receives this engine's token and the tunnel it dials, so `https://google.com`
must be refused rather than connected. The form reads the snapshot's
`instanceCheck` — *Checking https://st0.app…*, then nothing on success or the reason in red on a
refusal — and holds its Add button while one is being asked. The line under the form says what adding
means, because the check proves the software and not the owner
(`engine/st0-supervisor/docs/supervisorPolicy.md`).

### Sessions — what the status line could never say

One engine holds several projects at once, one per app driving it. The status line reports the
PROCESS (`● Running · id 3f2a91c4 · :8765`), and that reads the same whether the engine holds
nothing, holds one song, or holds a song and a deck and a module preview together. This tab is
the only place that answers *what is my engine doing, and for whom*.

`▶ playing` and `♫ n listening` appear only when true: a column of "not playing · 0 listening"
would bury the one session that IS playing among the ones that are not. The default session has
no name on the wire and is drawn as `(default)`, or the row reads as a session with no id rather
than THE unnamed one.

**Drop** throws that session's edit, plugins, meters and broadcast tap away. The app driving it
is not told, and will simply find an empty project.

Beneath each session sit its plugin instances whose OWN editor can open — the plugin's
`nativePluginUI`, not a module's `moduleUI` (the widget grid built in the web editor, which is
st0's business). A built-in has no window to show and gets no row. Nesting them under the session
is what a menu could not do: the same module id in two projects is two rows, and a flat list had
to spell the session out on every one of them.

The two lists are polled apart, so a plugin can name a session the engine has not listed in that
frame. Those rows are kept under a heading of their own rather than dropped — a plugin window
that blinks out of existence for one poll is worse than a heading nobody reads.

### Downloads — the instruments this machine keeps

Every instrument the engine can play, each with the one button that fits where it stands:
Download, Cancel while it waits its turn, Retry after a failure, Remove once it is here. Nothing
is downloaded until someone asks: the piano alone is 750 MB, and a machine that never plays it
should not pay for it. The list, the queue and the deletion are the supervisor's
(`engine/st0-supervisor/docs/instruments.md`); the tab draws the snapshot's `instruments` with
its `downloads` folded in. A running download has no button: the supervisor cannot cut one
mid-file, and says so if asked.

### Paired devices — approved on this machine, never from the network

A phone on the LAN drives the engine only once someone at THIS machine approves it; the verbs are
machine-only in the engine (`engine/st0-engine/docs/pairing.md`), and this tab is where the machine
says yes. Each request shows its 6-digit code large, because comparing it with the device's screen
is the whole check: anyone on the network can ask under any name.

A new request posts a PASSIVE notification naming the device and its code, never a modal: asking
costs a stranger on the LAN nothing, and a dialog per ask would let one lock this screen. The tab's
label counts the waiting requests, so "open Settings" lands one click away. Revoke takes effect at
once — the engine closes that device's live connections.

### System — the machine, and the buttons that act on it

Version, engine and registry as three facts, then Start / Stop / Restart. A page has room for the sentence a greyed-out menu row
never had: an adopted engine says *why* its buttons are dead, rather than just being dead.

`canAct` only GREYS those buttons. The rule that this app never stops an engine it did not spawn
is the supervisor's to enforce, and it does — a view is the wrong place for it to live.

## Safety rule: never kill someone else's engine

Stop and Restart are offered **only** when the supervisor OWNS the running engine. An adopted
(foreign) engine shows as Running in the System tab with those buttons greyed out and the reason
written beside them, so this app can never kill a process another owner manages — see
`ownsRunning` in `src/view.ts`.

## The Windows job object

What stops a force-killed tray from orphaning the supervisor and the engine holding its port is a
kill-on-close job. Node cannot create one, and libuv's own lets a grandchild break away, so the
supervisor makes it and hands the tray the only handle
(`engine/st0-supervisor/docs/hostProtocol.md`). Off Windows the closing stdin pipe plays the
same role.

## Quitting

On quit the supervisor does the actual work: deregister from the registry (while the engine
is still up and the entry still means something), then stop the engine, foreign or not —
closing the app is terminal, and an engine left listening holds the audio device and its port.

`SupervisorHost.stop` is the second half of that sentence, for the case where the supervisor never
got there: it hung on an unresponsive registry and was killed past its deadline, or it had already
crashed when the user quit. It kills the engine the pidfile names, tree and all. An engine that
survives the app is not just untidy — the NEXT launch adopts a process nobody is supervising.

Signals get the same treatment as menu Quit: launchd sends SIGTERM to stop a login item, and a
Ctrl-C in dev should deregister and stop the owned engine too.

## Death is read from the process, not the pipe

The supervisor's stdout is a pipe whose write end any surviving descendant can hold, and the
engine is built to outlive the supervisor. One inherited copy inside it means EOF never arrives.
The supervisor keeps its stdio out of its children (`engine/st0-supervisor/docs/supervisor.md`),
but the tray does not take that on trust: Node's `exit` event is the process's own, and a pipe
held open cannot delay it.

## The icon

Drawn in code (`docs/trayIcon.md`). On macOS its ink follows the system appearance, which Electron
pushes through `nativeTheme`; Windows and Linux trays are conventionally dark. It is not a
template image, which macOS would turn monochrome, badge and all. The spinner runs on the view
side, 8 frames a second while the engine is up but not ready: putting it on the pipe would turn an
idle app into a stream of messages to redraw one glyph.

## Launch at login

Electron's login items on macOS and Windows. Electron has none on Linux, so there the tray writes
the XDG autostart entry itself, naming `$APPIMAGE` when it runs from one: an AppImage's own path
is a temporary mount.

## Finding the supervisor (`src/paths.ts`)

Three tiers, and a LOUD answer when it is "nothing", because a tray that silently supervises
nothing looks exactly like a healthy one:

1. **`$STUDIO_ENGINE_HOST_CMD`** — an executable run with no arguments. The escape hatch for
   testing a custom supervisor build.
2. **Packaged** — `st0-supervisor` in the app's `Resources/bin`. Nothing on PATH, no repo needed.
3. **Dev** — the newest `st0-supervisor` under the repo's `engine/st0-supervisor/build`, Release
   before Debug, which `npm run dev` rebuilds on save.

## The merged log (`src/mergedLog.ts`)

`<state>/.studio.log` is written by the supervisor, which owns the engine and pumps its output
into it. Two jobs are left on the tray side:

1. **Truncate it once, at startup.** The tray's lifetime is what "a session" means, and it
   is the only process that knows a session began: the supervisor can be relaunched
   mid-session after a crash, and truncating there would wipe the log the user is reading
   to find out why it crashed.
2. **Write the `[host]` lines** — the supervisor's own stderr, plus the tray's notes about
   starting and losing it. These are what remain when the supervisor is the thing that
   broke, so they cannot live in the supervisor.

The lines are in the supervisor's format, `HH:MM:SS [tag] text`, not electron-shell's: the web
Logs panel parses this file. Both writers append, and a single append-mode write is atomic on
every platform, so whole lines interleave rather than tearing.
