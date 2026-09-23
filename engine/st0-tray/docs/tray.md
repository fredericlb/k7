# The tray app

## Names, and the ones a rename may not touch

The binary and the displayed name are `st0-tray`; the engine it supervises is
`st0-engine`. That covers the Cargo package, Tauri's `productName`, the tray tooltip,
the Quit item and the AppleScript dialog titles — all build artifacts, which the next build
replaces, so they rename in one commit.

**`org.parapluie.studio.engine-tray`, the bundle identifier, does not.** On macOS this is the
app's *identity*: changing it makes the OS treat the build as a different application, dropping
its microphone and automation (TCC) grants and its login item while leaving the old one
registered. It is also what Tauri keys single-instance on, so a mid-flight change means two
trays can run at once. It is frozen, and its own migration if it ever moves.

Neither does anything the user's DISK remembers: `<state>` and what is under it, the `STUDIO_*`
environment variables, and `x-studio-engine-token`. Renaming one of those without a migration
discards a person's settings and reads as a first launch — see
`packages/engine-client/docs/paths.md` and `docs/rename-test-plan.md`.

The pattern: a *build artifact* can be renamed in one commit. A name the user's disk or the OS
remembers cannot.

---

`st0-tray` is a tray Tauri app that starts with no window. It is the **VIEW** over the
supervisor (`@studio/engine-host`), which it spawns as a child and drives over NDJSON on
stdio: the supervisor owns the `~/.st0` contract, the registry, and — stage by stage —
the engine and the file service. The tray renders its snapshots and sends its clicks back.

Nothing in `tray.rs` opens a socket, spawns a process or reads a state file. What to allow,
which engine is running, what the ports are, where to heartbeat: all of it comes down in a
snapshot (`host.rs`), and a click goes back up as a command.

## What the machine must already have (`deps.rs`)

`git` and `git-lfs` are probed once at startup, before any of the stack is spawned. A machine
missing either gets a native dialog naming what to install and where, and then nothing else: the
tray exits rather than bringing up a stack that cannot import a workspace.

**Here rather than in the file service**, which is what actually shells out to them, for two
reasons. The supervisor and the file service are this process's descendants and inherit its
environment, so what the tray finds on PATH is exactly what they will find — the check and the
use cannot disagree about which `git` is meant. And a Windows release build has no console, so a
refusal that is not a native modal is a refusal nobody reads.

**It refuses rather than degrades**, because otherwise every symptom arrives far from the cause.
Without `git` a workspace is created but silently never versioned, publishing fails on a raw
`spawn git ENOENT`, and the library never mounts — which surfaces later still as `extends unknown
module '@st0/audio/utility/mixer'` on a project nobody touched. Without `git-lfs` a clone lands
pointer text where audio should be, and the song plays silence with every track present, unmuted
and looking correct (`packages/file-service/docs/workspaces.md`).

`tauri-plugin-dialog` is the one crate here that does not draw the tray, and this is what it is
for: the refusal has to be shown before the supervisor that would otherwise report it exists.

## The settings window

One window, `src-tauri/src/settingswin.rs`, holding what a MACHINE is set to rather than what a
project is. Six tabs, because they answer six different questions and only one of them is
ever urgent:

| tab | what it is |
|---|---|
| Audio | the interface ranking, as a list you drag |
| Plugins | the installed catalogue, filtered, and the rescan that refills it |
| Sessions | what this engine is holding, and the plugin editors it can open |
| Sync | where a playlist may be copied to — a stick, a folder, an FTP box |
| st0 instances | which st0 instances this engine is connected to, the origins just blocked, and a form to add one |
| System | version, engine, registry, file service — and every button that acts on them |

**The menu bar keeps one line and no buttons.** A status line is what a menu bar is for; a
ranking, a catalogue of several hundred rows, a list of live sessions and a row of destructive
buttons are not, and each was there only because there was nowhere else to put it. `Settings…`
is the way in, and the only one — the tray no longer draws a device, a count, a session, a
version or a web UI anywhere. A blocked origin still raises the icon's attention dot and a
banner; both point at the st0 instances tab.

It is hidden on close, never destroyed: Tauri asks an app to exit when its last window closes,
and this app's exit stops the engine. `windows` in `tauri.conf.json` stays empty for the same
reason it always was — nothing is opened until someone asks for it.

The page is hand-written HTML, CSS and JS under `dist/`, served as-is. The tray has no frontend
build and gains none for six tabs, which is what `withGlobalTauri` buys: a `<script>` tag
reaches `invoke` with no bundler in front of it. The window draws only what a snapshot said and
sends back only commands, so the rule that **the tray computes no policy** holds here too.

On macOS the app stays an accessory — no Dock icon and no app-switcher entry — so the window
comes forward on focus and leaves nothing behind when it hides.

### Audio — the list IS the ranking

The supervisor keeps an ORDER, not a chosen device: the first name in it that is actually
present is where the engine goes (`packages/engine-host/docs/supervisorPolicy.md`, *Why a list,
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
(`packages/engine-host/docs/hostProtocol.md` weighs what that costs). What the engine answers is
already the full list — the count was only ever `.length` of it — so nothing extra is asked of the
engine to draw this.

The list is read-only, deliberately: this is the INSTALLED catalogue, and everything you can do to
a plugin you do to an instance of it in a project, which is st0's business rather than the tray's.
The filter is there because a working machine has hundreds of rows.

### Sync — the targets a playlist can be copied to

A target is a name and a URI, `file://` or `ftp://`, and what a copy DOES with one is
[packages/file-service/docs/playlistSync.md](../../../packages/file-service/docs/playlistSync.md).
It is edited here for the reason the audio ranking is: it names something only this machine can
reach. A hosted screen cannot know what `file:///media/usb` is, and pl8 offers the button but never
learns the address behind it.

The list is the **whole value**, sent in one `sync.targets` as a reorder sends one `audio.priority`:
an edit is a single act, and two halves of it could interleave with a poll.

**The URI is shown in full, password and all.** Everywhere else in this repo it is blanked — pl8's
dropdown gets `ftp://dj:***@box.lan` — and here it is not, because this window runs on the machine
that already holds the file: hiding it would only stop you checking what you typed, while protecting
nothing. It is the one surface where showing it sends it nowhere.

**The scheme is checked here to answer at once, and that check is not the gate.** The supervisor's
normaliser is (`packages/song/src/preferences.ts`), and it drops a target it cannot copy to, so a
window that let one through would simply see it absent from the next snapshot. What the local check
buys is a sentence naming the mistake — `sftp:// cannot be copied to` — instead of a row that
silently fails to appear. The tray still computes no policy: it refuses nothing the supervisor would
have kept.

Removing one is a button on its row rather than a drag, since dropping a target is the only thing
this list does that reordering could not say — the same argument that gives an unplugged audio
device its **Forget**.

### st0 instances — none until you add one

A fresh machine is connected to **no** st0 instance, and nothing is suggested: the supervisor has no
default registry, seeds no origin, and ignores the local backends' `web-endpoints/` advertisements —
running `npm run dev` connects nothing either (`packages/engine-host/docs/supervisorPolicy.md`). This tab is
where one is added — its address typed into the form, and nowhere else.

Each row is one instance as the supervisor's `instances` reports it: the union of the registries this
engine heartbeats to and the origins `web-origins.json` lets through, keyed by origin, because to the
user those are the same thing. Adding sends `weburi.add`, which does both — the origin is allowed and
the engine is announced there, so it shows in that instance's picker. **Remove** sends `weburi.remove`,
which undoes both and deregisters at once. A registry that came from `$STUDIO_REGISTRY_URL` gets no Remove
and says why: the environment is not the tray's to edit.

Beneath the list sit the origins the file service **just refused**, with Allow and Ignore. This is how
an instance gets let in without anyone typing its URL — the blocked browser names itself. Allowing
one does *not* announce the engine there: approval widens which pages may call the file service, and
nothing else. Ignoring matters as much, or an origin you do not trust sits there training you to skip
the section.

The address is checked here, the way a sync URI is, only to answer at once — `ftp:// is not a web
address`, `already connected to …` — and reduced to the origin before it is sent. The supervisor's
`normaliseUserOrigin` is the gate. A bare host gets `https://`, as it does there.

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

### System — the machine, and the buttons that act on it

Version, engine, registry and file service as four facts, then Start / Stop / Restart, Restart
file service, and Clear waveform cache. A page has room for the sentence a greyed-out menu row
never had: an adopted engine says *why* its buttons are dead, rather than just being dead.

`canAct` only GREYS those buttons. The rule that this app never stops an engine it did not spawn
is the supervisor's to enforce, and it does — a view is the wrong place for it to live.

## Safety rule: never kill someone else's engine

Stop and Restart are offered **only** when the supervisor OWNS the running engine. An adopted
(foreign) engine shows as Running in the System tab with those buttons greyed out and the reason
written beside them, so this app can never kill a process another owner manages — see
`AppState::owns_running`.

## The Windows job object (`job.rs`)

The graceful path (`cleanup_async`) stops the engine and file service when the user picks
Quit, but nothing runs when the tray is force-killed or crashes — and its children would
then orphan and keep the engine and file ports bound.

A job object closes that gap. Every process the tray spawns is assigned to one job whose
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag terminates all members when the last handle to
the job closes, and the OS closes our handles when the tray ends however it ends. It also
subsumes the grandchild problem for free: a process created *by* a job member joins the job
automatically, so the `tsx`-forked file-service node is covered with no tree walking.

This is why the job is created in `main.rs` **before anything is spawned** — membership is
inherited, so a force-killed tray takes the whole stack with it. Off Windows the closing
stdin pipe plays the same role.

## Quitting

On quit the supervisor does the actual work: deregister from the registry (while the engine
is still up and the entry still means something), then stop the file service and the
engine, foreign or not — closing the app is terminal, and an engine left listening holds
the audio device and both ports.

`pidkill.rs` is the second half of that sentence, and runs after the supervisor on the way
out for the case where it never got there: it hung on an unresponsive registry and was
killed past its deadline, or it had already crashed when the user quit. An engine that
survives the app is not just untidy — the NEXT launch adopts a process nobody is
supervising. The pidfile is the contract both sides already agree on (see
`engineDaemon.ts`), which is why this needs nothing else to work.

Signals get the same treatment as menu Quit: launchd sends SIGTERM to stop a LaunchAgent
(autostart), and a Ctrl-C in dev should deregister and stop the owned engine too.

## State (`state.rs`)

Two halves, and the split is the whole point:

- **`snapshot`** is what the SUPERVISOR reported. The engine, the file service, the
  identity, the ports, the registry, the audio picks, the allowlist — none of it is
  computed or written here. It arrives whole and replaces what was.
- **everything else** is view state the tray genuinely owns, and there is very little left:
  the spinner frame, the menu-bar darkness, the menu handles, and the two signatures
  recording what the submenus were last *drawn* from (the supervisor computes the
  signatures; these are the tray's memory of which one it rendered).

## The remaining loops (`supervisor.rs`)

The name is a misnomer — the supervisor is `@studio/engine-host`. The registry heartbeat,
the refused-origin poll, the crash watch, the file-service watch and all three engine-query
polls belong to it: it owns those files, those processes, and the one connection to the
engine.

Two loops live here, and both are genuinely view work:

- `spinner_loop` runs at 8 frames per second. Putting that on the pipe would turn an idle
  app into a constant stream of messages to redraw one glyph — exactly the cost the
  snapshot design exists to avoid.
- `appearance_loop` re-reads the menu bar's light/dark, which nothing pushes to us.

Every loop snapshots the state under a short lock and **drops the guard before any
`.await`**: a std `Mutex` must never be held across an await point.

## Paths (`paths.rs`)

The layout is defined by `packages/engine-client/src/paths.ts`, not here. The three paths the
tray opens for the user (workspaces root, merged log, origins file) arrive in the supervisor's
snapshot rather than being recomputed. What is left belongs to subsystems the tray has not
handed over yet, and goes with them.

## Finding the supervisor (`hostcmd.rs`)

The tray answers one question — "what do I exec?" — in three tiers, and says clearly when
the answer is "nothing", because a tray that silently supervises nothing looks exactly like
a healthy one:

1. **`$STUDIO_ENGINE_HOST_CMD`** — an executable run with no arguments. The escape hatch
   for testing a custom supervisor build.
2. **Packaged** — the vendored `node` beside our executable, running the esbuild'd
   `engine-host.mjs` from the app's resources. Nothing on PATH, no repo needed.
3. **Dev** — `node` from PATH running the repo's `tsx` CLI on the TypeScript source, so
   `npm run engine:dev` supervises with no build step.

Tier 3 exists only because `buildDevApp()` deliberately ships an app with an empty
`resources` list; that is what makes a dev build take this path rather than a stale bundle.

## The link itself (`host.rs`)

One JSON object per line: snapshots and notifications come up on the supervisor's stdout,
commands go down its stdin. The written definition of the format is
`packages/engine-host/src/hostProtocol.ts`; the structs in `host.rs` are its hand-written
Rust mirror — the same arrangement `engine-protocol` has with the C++ engine.

It is deliberately **partial**: only the fields the tray consumes are mirrored. serde
ignores the rest, so a snapshot field belonging to a subsystem the tray does not own simply
does not appear — and adding one is how a later stage takes it over.

The supervisor is spawned into the kill-on-close job, which makes it (and everything it
comes to own) die with the tray on Windows however the tray ends; on Unix the pipe does the
same. A supervisor that crashes is relaunched with 1s→30s backoff, and the engine survives
that because the pidfile lets the fresh supervisor re-adopt it.

## The merged log (`logbus.rs`)

`~/.st0/.studio.log` is written by the supervisor, which owns the engine and the
file service and pumps both into it. Two jobs are left on the tray side:

1. **Truncate it once, at startup.** The tray's lifetime is what "a session" means, and it
   is the only process that knows a session began: the supervisor can be relaunched
   mid-session after a crash, and truncating there would wipe the log the user is reading
   to find out why it crashed.
2. **Write the `[host]` lines** — the supervisor's own stderr, plus the tray's notes about
   starting and losing it. These are what remain when the supervisor is the thing that
   broke, so they cannot live in the supervisor.

Both writers open in APPEND mode after the truncate. A single append-mode write is atomic
on both platforms, so whole lines interleave rather than tearing.
