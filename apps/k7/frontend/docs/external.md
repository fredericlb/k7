# One surface, on another device

A surface is a screen the project declares. Some are things you use **while walking away from the
computer** — a desk you want on a tablet propped beside the decks, not on the laptop behind. So each
surface has an address of its own:

```
<project>/@external/<surface>

https://app.priv.k7.rocks/lemo_mante/mymix.k7/@external/desk
```

Opened on another device, it gives **that surface and nothing else**, driving the same engine as the
tab with the project open.

## Under the project, which costs nothing

`parseLaunch` ends a project at the last segment carrying the app's suffix; everything after it is
already the app's route. So:

| | |
|---|---|
| `parseLaunch` | unchanged — `{ repo, project }` as ever |
| `projectBasename` | unchanged — the router mounts in the same place |
| `routes.ts` | nothing: `main.tsx` reads the address before the router |

Same shape as `@shares/<token>.k7`, for the inverse reason (a share slips into the PROJECT's place,
an external surface into the ROUTE's), and the same `@` sentinel: it cannot start a workspace's
name, and it cannot be a surface id either — `createSurfaceFile` accepts only letters, digits, `_`
and `-`. Collision is impossible on both sides.

`EXTERNAL_SEGMENT`, `externalUrl` and `parseExternal` live in
[`@studio/web-protocol/projects`](../../../../packages/web-protocol/projects.ts), beside `launchUrl`
and `shareUrl`, because this is an **address contract**: one side writes it, the other reads it, and
an address only one of them understands is a 404 nobody can attribute.

## The same gates, a different render

An external surface needs exactly what the editor needs: the account, an engine, and the workspace
resolved into a folder on that engine's machine. So it borrows the same stack —
`AuthGate → EngineGate → ProjectGate` — and changes only what is rendered at the end:

```
main.tsx   parseExternal(pathname)  ─┐
                                     ├─ EngineGate external= ─ ProjectGate external=
                                     │        └─ external ? <ExternalSurface/> : <App/>
```

It is **not** the shell with things hidden. The shell with nothing in it is still the shell: its
panels and its bar all belong to a screen this device does not show. `ExternalSurface` mounts what a
surface needs — the engine link, the desk, the video document, the command runner — then hands over
to the component the type names. No logic is duplicated: those hooks exist precisely so a host can
wire a surface (`../../../../packages/k7-plugins/docs/turntables/hosting.md`).

Three things are not the surface and are there anyway, at the head and the foot: the **transport**, a
**command line**, and the **keyboard**. They do not come from the same reasoning as the panels —
they are not screens, they are the three ways of commanding the one you are looking at.

## The transport, at the head

`MiniTransport` (`src/shellMeta.tsx`): play/pause and the clock, nothing else — stop, rewind, record and the metronome are
decisions about a session you are looking at, and the keys do all of them anyway.

A tablet by the decks is where the hand is; walking back to the laptop to press play is what this
screen exists to avoid.

The clock subscribes to `playhead` by itself (`shellMeta.tsx`): at ~20 Hz, a subscription taken at
this level would redraw the whole surface every frame.

## The keyboard, whole

`useCommandKeys` is the shell's listener, shared with it — same withdrawal rules (a field being typed
in owns its keys, a focused button gives back Space and Escape), same ⌃C exception on a text
selection, same **double-Shift**. One keyboard cannot become two.

The keymap is the person's: `effectiveKeys(commandPrefs)`, with the preferences read from
`engines.prefs()` as in the shell. A remapped play key has to work on the tablet too, or the two
screens are two instruments.

Double-Shift opens the **command line** at the foot — what the gesture means here, as it focuses the
anchored bar or opens the palette in the shell. The host supplies the gesture, the listener only
recognises it.

What the surface answers **itself**, before `/command`:

| lines | why |
|---|---|
| `transport play` / `stop` / `toggle` / `rewind` | over the socket, as in the shell: the file service would send that message after an HTTP round trip and a walk of the undo journal |
| `transport replay` | a seek to the start of the current run, then the bare verb |
| `transport locate`, `transport loop`, `ui select`, `ui zoom …`, `ui ruler`, `ui lanes`, `ui automation` | the cursor and the zoom belong to the mounted pane (`TimelineHandle`); no service can move them. On a surface with no arrangement, the line **says so** — the key is bound, the command exists, it is the device that is the wrong place |
| any other `ui …` | names a pane, a panel or a screen this device does not have — refused **in words**, rather than posted to a service that would answer "unknown command" |

The **layout** verbs (`ui close`, `ui global`, `ui focus next`, the two closes) are the one exception
to that last line: they stay silent. That is what Escape and Tab come to when there is nothing to
close, and a screen answering Escape with a sentence about the editor is a screen that grumbles
every time you dismiss something.

The conditions (`caret_track`, `timeline_selection`, `timeline_zoomed`, `timeline_loop`) come up from
the mounted surface. The shell draws them from its own state; here there is one surface and it holds
them all. Without them, `m` and `s` would send an empty-argument command instead of staying quiet.

## All four types drive

| type | drawn by | what the host gives it |
|---|---|---|
| `turntables` | `SurfaceTab` | the desk (`useTurntableDeck`) |
| `mastering` | `MasteringTab` | the engine link: `setPluginParam`, `watchPluginParams`, the param store |
| `viewport` | `ViewportTab` | the compiled picture (`useVideoDoc`) |
| `timeline` | `ExternalTimeline` | everything else — see below |

None of the four asks for the shell, which is what makes them all drivable here:

- `mastering` asks only for **an engine link**, which this screen already has.
- `viewport` asks only for a **video document**, which is a `GET /video-doc`.
- `timeline` asks for more, but what it draws on — the cursor, the zoom, the selection — does not
  belong to the shell: it belongs to the **pane**, and `TimelineTab` holds them itself. What the
  shell really supplies is writing: the commands, the menus, the loop. `ExternalTimeline` rewires
  those without it.

So no surface has only an address, and there is one dead-end screen: the address names no file in
`surfaces/`.

### The timeline, on a tablet

The same `TimelineTab` as the shell's pane, with the same write gestures, each to the same command
line:

| gesture | line |
|---|---|
| move a clip | `event move` |
| drag a handle | `event resize` |
| drag a fade corner | `event fadein` / `event fadeout` |
| the corner button | `track new` |
| mute / solo / arm | `track mute`, `track solo`, `transport arm` (`useTrackControls`) |
| move a picture | a **file write**, not a command — the CLI has no verb for placing a picture (`useVideoEdits`, `picture.md`) |

Three things come from somewhere other than the shell, because there is none:

`useSurfaceCommands` is the runner — `/command`, a reload key, a status line, and a hook for what the
screen answers itself (the table above). It asks `want: []` every time: the graph the service can
build on the way is for the chains canvas, and there is none here. Its reload key follows the
**`/revision` token** and not only our own writes — a tablet is a second screen on a project also
being edited on the laptop, so most of what it must follow is not its own.

The **graph** is refetched here, on that same token, where the shell takes it from the chains pane:
without it the gutter would draw neither the alternatives badge nor the automation curves.

The **context menu** is the shell's, `contextMenu.ts`, and the gutter badge's menu is `nodeMenu`,
shared with it: two derivations of one menu are two menus that end up offering different
alternatives on the same node.

### A line, and not a command bar

A menu entry is either **complete** — the click filled all its arguments, it runs — or it still owes
one, and in the shell those go into the bar half-written. There is no bar here. Dropping them would
have removed "New alternative…" from a menu that is entirely about that; building one would have
rebuilt the shell.

So the foot carries **one line**, filled by those entries, opened by double-Shift, and typable in its
own right. No completion, no palette, no catalogue behind it: what makes those three useful is a
keyboard — but the line itself is useful exactly when there is one, or when a menu has just dropped a
command to finish into it.

It is at the foot of the HOST and not of the timeline: double-Shift has to answer on a desk as on an
arrangement, and a menu opened on any surface needs somewhere to drop its line.

### What is not offered

**MIDI** capture. It happens in the browser holding the keyboard, and that one is across the room;
`transport arm` does work, because that is arming the **engine**. And `trackIds` is not passed to the
`viewport`: that list indexes the engine's `levels` array for a shader with an audio input, which
almost none have — passing it would mean compiling the song on a device that only shows its picture.

## Getting the link

In the **Share panel**, at the bottom: one line per surface, with its type, and beneath them the
sentence that matters — *same engine, same session*. Each line is a real link opening in a new tab,
which is the shortest way to send it elsewhere: open it, take the address bar. Beside it, a *Copy*
button.

That panel and not another because it is already where you go for **any address the project hands
out** — the frozen link, the k7 release (the rehearsal recorder's) — and because the gesture is the same: you give a link to
someone, or to a tablet.

The panel lists **all** declared surfaces: all four types draw, and a filter here would hide a
working address.

The command **copies** it to the clipboard and writes it into the status line — so it is readable
and retypable even if the browser refuses the write. It does not navigate: the point is to carry the
address to a second device, and following it here would replace the editor you are standing in front
of with the tablet's screen.

It is built from `window.location.href`, like `shareUrl` and for the same reason: a local copy, the
network's proxy and the public host are three different answers, and only the tab knows which one it
is reading. The tablet is on the network's.

## `/external` — the menu, and a PWA's starting point

A link you have to go and fetch from the editor only serves once: the tablet needs a page of its own,
opened knowing nothing, on which an installed application starts. That is `/external`: **the
surfaces of the project the engine is holding**, one line per surface.

Opening it the first time is its own problem, and typing an address on a touch keyboard is not a way:
the **open project's share panel** gives the QR codes — the whole project first, then each surface
(`apps/k7/frontend/src/components/SharePanel.tsx`, section *Sur un autre appareil*).

```
GET /workspaces/surfaces        (file service)
  → [{ workspace, repoName, uniqueName, path, app, active, surfaces: [{id, type}] }]
GET /engine/served
  → { project: { workspace, path } | null }
```

Two requests, on the same tick, outside any project — like `/workspaces/projects` next door, and for
the same reason: a menu that fills line by line is not a menu. The first is memoised for five
seconds, the window of the list it is built on, and it is **separate** from that one: the home page
draws no surfaces and must not pay a scan per project.

The service does not say what is worth opening, it says what is **declared**, and what the engine is
holding. The crossing is the app's.

### Only the loaded project

This menu does not list the whole machine: a line from another project would **move** the engine,
because an engine holds one project per session
(`packages/engine-protocol/docs/sessions.md`). Following a random line from a tablet would be a way
of interrupting yourself across the room, and would drown the one useful line — the open project's —
among the others.

The filter is `/engine/served`, not the `active` flag each line carries. The two answer different
questions: `active` is a **workspace**'s active-project marker, one per workspace, written by
whoever opened last — a machine with three markers is still one engine holding one song. `served` is
the file service's note on what it has **sent**, one per session, so one project for the whole
account (`packages/file-service/docs/activeProject.md`).

It is a belief about another process, like every read of `served`: the engine may have restarted.
It is not asked here — `prewarmEngineForActive` already asks, with its throttle, and a menu naming a
just-released project for one second too long corrects itself on the next tick.

The project is the page's **title**, and "Surfaces" the line below it — that is what the page is: a
menu of screens OF SOMETHING. Lines carry their type instead of repeating the only thing they have
in common, and none carries an "open" badge: they all would.

Two empties, and they do not say the same thing. *No project open on the engine* — the disk may be
full of surfaces, but none would join anything; you open a project in the editor, where the person
is. *No surface in this project* — the loaded one declares none.

This page borrows `Home`'s stack and not the editor's: the account, `engines.find()`, and above all
**never `hold()`**. A lease is a claim ON A PROJECT; taking one from a menu would evict whoever is
playing. Following a line does claim — through the gates, which are the place for it.

And that claim does not evict the editor. One account on one engine is one session and one loaded
project: the "one engine per project" rule exempts this case, and without that exemption opening a
surface would send the laptop back to *"this project was opened elsewhere"*. See
`packages/engine-registry/docs/claim.md`.

### `external`, a plain word

Every project address starts with a sentinel (`@local`, `@banc`, `@shares`), so a plain word after
k7's mount collides with nothing, and `/external` is read before `parseLaunch` (`isExternalIndex`).
The bare word is the address that was wanted: it reads in the address bar, and a second device's
home-screen icon points at it.

### How you get there

The menu is reachable by its hand-typed address, and by `ui external <surface>` from an open project
— which gives ONE surface's link. Neither is discoverable from the tablet you have just set down on
the amp. So the open project's share panel gives its QR code, and the device keeps it from then on —
installed, it starts here.

It is linked from neither the home page's sidebar nor the editor's: it is an INDEPENDENT page, the
second device's own, and it wears its own header rather than the home page's. Reaching it from the
laptop would only open on the laptop what belongs on the tablet.

Never a route, and that matters: `/external` is read by `main.tsx` **before** the router,
so arriving by client navigation would leave the document on the editor's manifest, and the device
would install on the wrong application. A real navigation re-reads the document, and the
`<link rel="manifest">` with it.

### Two manifests

`start_url` resolves against the **manifest**'s address, not the document's: `manifest.webmanifest`'s
relative `.` is `/` wherever you install from. Right for the editor, wrong here — a device installed
from this menu would return to the home page on every start. Hence
`manifest-external.webmanifest`, `start_url: "external"`, `scope: "."` (so surfaces under a project
stay inside), and `main.tsx` swapping the `<link rel="manifest">` when the document IS this page —
beside the routing decision it follows from.

### No new tabs

Neither here nor from a surface. Installed, this application has no tab and no address bar: a
`_blank` would open a window you cannot come back from. Lines navigate in place, and the surface
carries a **Surfaces** link at its foot to go back up — an `<a>` and not a route, the router being
mounted under a basename that stops at the project. The dead-end screen carries it too.

The Share panel keeps its `target="_blank"`: it is in the editor, on the machine you work on, and
navigating in place there would replace exactly the screen you are looking at.

### The same address on both sides

`externalHref` goes through `projectHref`, so the tablet and the editor spell a project's
`@local/…` address alike. Not cosmetic: the engine identifies a project by its address
(`projectClaimKey`), and two spellings of one song would make **two claims on it**, the second
evicting the first. That, and nothing else, is why this menu builds its links with the editor's
own function.

A tablet on the local network that its engine has not paired yet draws the pairing card in place of
"no engine answers" — `pairing.md`.

## Looking like an application without being able to be one

A PWA installs from a **secure** origin, and a tablet reaching the machine over the LAN in the clear
has none. Installation is therefore out of reach exactly
where it would help most. What can still be had is what an installed application gives *on screen* —
and neither half requires a secure origin.

### Full screen

The Fullscreen API is conditioned only on a **gesture**, never on a secure context. A button at the
foot of a surface (`useFullscreen`) is enough to make the address bar disappear, in the clear as over
https. Two details that only show in use:

- Safari has only ever had the prefixed spelling, hence two of each in the hook;
- **Safari on iPhone has no API at all** (it exists only for `<video>`), so the button is not drawn
  rather than drawn dead — `available` answers that and nothing else.

iOS makes up for it elsewhere, and the other way round from usual:
`apple-mobile-web-app-capable` in `index.html` gives a real standalone launcher **with no service
worker and no https**. On an iPad you therefore get the icon *and* full screen in the clear; on
Android, where installability requires https, the button remains. Either way, every tablet can lose
its address bar.

The name the device shows comes from the meta and never from the manifest: `appMain.tsx` swaps the
two together when the page is `/external`, or the icon would say "k7" for a menu of surfaces.

### The screen staying on

That one is a real loss, and the more expensive of the two: `navigator.wakeLock` **requires** a
secure context, so on the tablet in the clear it does not exist. A surface watched without being
touched goes dark after two minutes, which mid-session does not read as a power policy but as a
crash.

`useStayAwake` therefore takes the lock when it is there, and otherwise plays a **muted 1×1 video**
drawn from a canvas — the old trick, which phone browsers have never stopped honouring. None of it
is verifiable from a script: it is best-effort by construction, and the failure signature is the
screen dimming anyway.

The lock is released by the browser on every trip to the background, so it is **retaken** on return;
without that it would hold only until the first notification.

### The camera

Not lost either, for a reason unrelated to the two above: `RTCPeerConnection` is conditioned on
nothing. The machine opens the lens, the tablet receives it — see
`packages/song/docs/camera.md`, which also says why it runs in that direction.

## What this is not

It is not a share. A share (`@shares/<token>.k7`) is a **frozen** snapshot, with no account, no
engine and no source — see [shared.md](shared.md). An external surface is the opposite on all three
counts: it demands the account, it requires an engine, and it **writes** — a deck loaded from the
tablet is loaded for everyone, because it is the same engine and the same session.
