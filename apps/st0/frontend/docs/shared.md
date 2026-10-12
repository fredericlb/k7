# Shared mode — st0 opened on a frozen snapshot

An address in `/@shares/<token>.st0` opens **this application**, with no account, no engine and no
working copy. What it draws is a snapshot the media library holds: three compiled documents and audio renders.
The bundle is built elsewhere — see
[`packages/commands/docs/shareBundle.md`](../../../../packages/commands/docs/shareBundle.md) for
what it contains, and [`apps/st0/backend/docs/media/shares.md`](../../backend/docs/media/shares.md) for where it lives
and how it is withdrawn.

## One branch, not three conditional gates

`main.tsx` reads the address once — the same way the router's `basename` does, so the two cannot
disagree about which project is open — and renders either `SharedGate` or the usual
`AuthGate → EngineGate → ProjectGate` stack.

A share has no account, no engine and no workspace. It is not the same stack with three switches:
it is the **wrong stack**. Making the three gates conditional would put three `if`s in three files
none of which has any reason to know about shares, and each would be a place to forget it.

## What PREVENTS writing is one line

`fsend` refuses. That is all.

```ts
const frozen = cfg().frozen;
if (frozen) throw new ReadOnlyDocument(frozen.why);
```

Every write of every application mounting this shell goes through it — a good twenty calls in
`project.ts` alone. Refusing **at the transport** rather than feature by feature is the only
version of this refusal that is true: a hidden button is still one keyboard shortcut, one command
bar entry and one context menu away, and the twenty-sixth write would be discovered in production.

What `snapshot` does in `App` is therefore a question of what is **drawn**, never of what is
prevented — but it has to be done, and done to the end: a clip you can still drag is a gesture that
works on screen and produces nothing. **A drag that runs and then snaps back is worse than a drag
that never starts**, and a resize handle lighting up under the cursor is a promise. So:

- `TimelineTab` takes a `readOnly` that joins the guard already there for a generated track and a
  frozen clip (`if (readOnly || track.generated || c.frozen) return`). Press is still tracked,
  because a CLICK is a request to SEE the clip and asks nothing of the disk;
- edge handles are not inert, they are **absent**;
- the graph's five edit callbacks (`onConnect`, `onDisconnect`, `onReplug`, `onMoveNode`,
  `onEdgeInsert`) and the picture's (`onVideoEdit`) are **optional and already guarded by the
  renderer**: a snapshot passes none, and the sockets are not offered. No extra flag is needed on
  that side.

Both header menus disappear because they make no sense here: Share publishes THIS project somewhere
(there is no project, only a copy), and Settings changes engine, workspace and account preferences,
none of which a visitor has. A greyed menu would be an invitation to log in — exactly what a share
exists to avoid.

## The editor is not a read-only pane, it is not there

`viewPanes(view, timeline, viewport, frozen)` removes it from `fullscreen`. A snapshot has **no
source** — no `/tree`, no `/file` — so it is not a pane whose document happens to be frozen, it is a
pane with nothing behind it.

Removing it from that list, rather than from a button, is the point: the same list is read by the
number keys, the phone menu, `ui editor` and **every address**. One omission closes them all.
`fromLocation` takes the same flag, or `/editor` pasted into the address bar would open a pane
nothing mounts.

## The engine: `() => null`, and nothing else to do

`EngineUrl` accepts a function, and `null` already means "no engine to reach right now": the client
waits and asks again instead of treating it as a connection failure. That is the seam that makes
"st0 itself" possible with no second code path — the shell mounts whole, its `EngineStore` stays
idle, `connected` is false, and transport verbs go into a client with no socket.

## The canned routes

A share is a folder of JSON and renders. `/tree`, `/hints`, `/commands`, `/io-ports`
name **nothing** — there is no file service behind it. Left to fail, every hook asking
for them would show an error saying a service is down, which is **false**: it is absent by
construction, and a viewer announcing a broken server while everything does what it should is worse
than a silent one.

`FileCfg.frozen.canned` answers in their place, before the request, in JSON text each caller parses
— `fget`'s rule, so that several components never share one object.

Two details that matter:

- **the values are typed**, not cast. Writing `Hints` out in full fails compilation on a forgotten
  field — `paramsByBase`, `paramMetaByBase`, `racks` — rather than letting it reach a component as
  `undefined`, on the one code path nobody opens;
- `/revision` returns a **constant**. Several hooks poll that token and reload when it moves;
  frozen, the shell settles after its first pass and stops asking, which is the true statement
  about a document that cannot change.

`/project-errors` returns "no errors", and that is an answer rather than a stopgap: a snapshot is
made from a project that compiled, by the machine that compiled it.

## The address is a `base`, and that is all

`cfg().base` is a string set once. Nothing requires a file service to answer behind it, so the
media library serves the same GET shapes from the bundle and st0 does not notice.

The one seam to adjust is the NAME: `fget` asks for `/project-doc` because that is the file
service's route, and the snapshot calls the same bytes `project-doc.json` because a file needs a
name. The public route accepts both spellings — a `||` — rather than teaching either side that the
other exists.

`mediaUrl` is not handled and does not need to be: it builds `<base>/media?…`, which lands on the
public router's terminal 404. A clip waveform has nothing to read; it draws none.

## The key is computed here

`shareKey(token)` does a `sha256` in the browser, because the media library files the HASH and never the secret:
a path segment reaches every access log. That needs `crypto.subtle`, so a **secure context** — over
plain http anywhere but localhost there is no digest at all. The refusal is raised with a sentence
rather than left to surface as `undefined is not a function`: it is a deployment matter, not a bug,
and the remedy is to serve the page over https.

## Playback: a browser clock filling the same store

`useSnapshotPlayer` substitutes **two verbs** — `transport` and `seek` — right after
`useEngineLink`, and nothing else.

Two places would still wait for an engine and would make transport unusable, so they carry the
`frozen` flag at the head of their condition:

- `waitingForEngine` is `!frozen && !!ws?.activeProject && !engineReady`. The canned `/workspace`
  says `activeProject: "."`, and `engineReady` never becomes true without a socket — without the
  first term it would be "waiting for engine…" for ever, with the bar greyed out. On a snapshot
  there is no engine to wait for;
- the four bare verbs fall back to the file service when `connected` is false
  (`if (!frozen && (!connected || engineBusyRef.current)) return false`), which is the right trade
  when there IS a service behind. Here there is not, and the space bar would do nothing: the local
  path is the only one that can answer, and it always does.

Everything downstream — the bar, the keys, `transport play`, the playhead, `replayAtRef` — reads the
same frames from `store`, whichever side fills them. None of those pieces learns there is no engine.

**One `<audio>` per file, not a decoded buffer.** The numbers decide: twelve four-minute stems
decode to over a gigabyte of float32, which no phone has. A media element streams, makes its Range
requests — exactly what `streamFile` already serves — and carries the `currentTime` this hook
publishes as the playhead.

### What that costs, and the three rules that pay for it

A media element **cannot be scheduled**. `AudioBufferSourceNode.start(when)` is sample-accurate,
`el.play()` means "soon": several elements started in the same tick each begin when they have
finished buffering, hundreds of milliseconds apart. On a set of stems that is not drift, it is
cacophony.

1. **Only the group that SOUNDS is played.** The mixdown, or the stems, never both. Thirteen
   simultaneous streams for someone who never mutes anything would be the whole snapshot's
   bandwidth to hear one file.
2. **Nothing starts before every voice of the group can play**, from the same position. A slow stem
   delays the group by its own buffering instead of arriving late for ever. A generation counter
   cancels a start overtaken by a stop, a seek or the crossover.
3. **Drift is corrected with `playbackRate`, not `currentTime`.** Writing `currentTime` on a
   playing element makes it re-buffer, so it falls further behind, so the next correction is bigger:
   the stutter feeds itself. A nudge of ±4 % is inaudible and closes the gap in a second or two. The
   hard jump is kept for the one case no survivable rate catches up: half a second out, which is
   lost rather than late.

### Crossing to the stems: against the MIXDOWN, never against silence

The mixdown is rendered **from the document**. A track the document mutes is therefore already
absent from the file. Reading "this track is muted" as "the visitor muted it" would switch to stems
for any project that mutes anything, **before a single click** — the loudest possible way to be
wrong, since the mixdown is the one file whose alignment cannot be wrong: it is alone.

`matchesMixdown` is that rule, pure and tested: `App` computes `laneGains` **twice**, once on the
on-screen controls and once on the document, and only a difference is the visitor asking for
something the render does not already say.

The audio graph is built at the **first transport verb**, never at mount: an `AudioContext` made
outside a user gesture starts suspended, and elements with `preload="auto"` would pull megabytes for
someone who is reading the graph and will never press play.

By default you hear **the mixdown**. On the first mute it crosses to the **stems**, once and for the
session: going back to the mixdown when every track is unmuted again would be a second audible seam
for someone who is only exploring, and the stems sum to the same song.

`levels` stays **empty** rather than zeroed: a meter with no engine behind it has no reading, and a
row of bars at -∞ would be an assertion about silence nothing measured.

### Mute and solo become what a listener means by them

Normally they are WRITES: `m` rewrites the track's bypass in `graph.yaml` and `s` the `soloed:` list
in `project.yaml`, because a mute is a decision about the song and not a session flag. Here there is
nowhere to write and `fsend` would refuse — so `useTrackControls` takes a `local` mode where the
optimistic state IS the value: nothing to dispatch, nothing to reconcile.

`arm` is untouched and stays a command: nothing arms without an engine, and the refusal that says so
beats a button that pretends.

Resolving to audio is `laneGains`, pure and tested — because **solo is a fact about the WHOLE**: one
soloed track silences every other, so a track's answer does not follow from its own two flags. That
is the rule the engine applies to `soloed:`, stated where there is no engine to apply it.

A stem whose render matched no track (`track: ""`) is deliberately absent from the table: it sounds,
and no button addresses it — which is honest, where hanging it on an invented identifier would light
up another track's button.

## Comments: the one write, and the one panel

A share is frozen, and a **comment** is not an exception to that: it changes nothing of the
project. It is a block of text beside the snapshot, with an optional timecode — where the playhead
was when it was written.

`CommentsPanel.tsx` is a **panel**, docked at the right beside the panes, and takes the fourth slot
in `rightPanel`. Not a pane: a pane is something the project declares, and this is not part of the
song. The header's button replaces nothing — it sits beside the download, which was until now the
whole of a visitor's half of the header.

**It is the only write in this shell that does not go through `fsend`.** That is the sentence to
keep: the transport's refusal is what makes a share read-only, and nothing here weakens it. This
panel talks to the media library's public router directly, on the same base the audio streams from, and the file
service is not in the path at all. What bounds that route is
[apps/st0/backend/docs/media/comments.md](../../backend/docs/media/comments.md).

### The timecode is CAPTURED, never live

The pin button reads `store.getSnapshot().playhead` at the click and freezes it on the chip; a
second click drops it. The panel does not subscribe to the store, and that is the point: the
playhead publishes ~60 times a second, and a panel re-rendering at that rate while someone is
typing into a textarea is a panel that fights them. What the chip says is what will be filed.

Going the other way, a comment's timecode is a **button**, and it seeks. A note about a moment is
worth nothing if reaching that moment is a scrub.

### The visitor's name is a claim, not a fact

There are no accounts here — that is what a share is. So the name is a field, remembered in
`localStorage` under one key so the second comment does not ask again, and a comment with none
reads as "someone". Nothing pretends it is verified, because nothing could.

### The three states are shown, and not offered

`active`, `resolved`, `ignored`, as a chip on every row and with **no tabs**: a visitor reads one
list. Whoever wrote a comment is owed the answer to "was this looked at", so hiding what became of
it would be the wrong secret to keep; moving it is the author's, and happens in st0's home page —
[projects.md](projects.md).

The panel does not poll. A share is read in one sitting, and a timer per open tab against a public
route is a cost the feature does not need; the list re-reads when the panel is opened.
