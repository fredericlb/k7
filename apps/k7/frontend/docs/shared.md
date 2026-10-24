# Shared mode — k7 opened on a shared version

An address in `/@shares/<token>.k7` opens **this application**, with no account and no working
copy. What it draws is a share held by the media library, made at a checkpoint of the project: the three
documents a browser draws a project from. What it plays is that checkpoint, on the server's own engine,
in a session that belongs to this visitor alone. See
[`packages/file-service/docs/share.md`](../../../../packages/file-service/docs/share.md) for how a share is made,
[`apps/k7/backend/docs/media/shares.md`](../../backend/docs/media/shares.md) for where it lives and how
it is withdrawn, and [`apps/k7/backend/docs/media/sharePlayer.md`](../../backend/docs/media/sharePlayer.md)
for the session.

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
  renderer**: a share passes none, and the sockets are not offered. No extra flag is needed on
  that side.

Both header menus disappear because they make no sense here: Share publishes THIS project somewhere
(there is no project, only a copy), and Settings changes engine, workspace and account preferences,
none of which a visitor has. A greyed menu would be an invitation to log in — exactly what a share
exists to avoid.

## The editor is not a read-only pane, it is not there

`viewPanes(view, timeline, viewport, frozen)` removes it from `fullscreen`. A share has **no
source** — no `/tree`, no `/file` — so it is not a pane whose document happens to be frozen, it is a
pane with nothing behind it.

Removing it from that list, rather than from a button, is the point: the same list is read by the
number keys, the phone menu, `ui editor` and **every address**. One omission closes them all.
`fromLocation` takes the same flag, or `/editor` pasted into the address bar would open a pane
nothing mounts.

## The engine is the share's player, and nothing else changes

`SharedGate` hands the shell the share's player socket as its `engineUrl`. The shell's
`EngineClient` talks to it exactly as it talks to an engine. The transport bar, the playhead, the
meters and `playEngineOutput` work unchanged: the player says `audioToBrowser`, so the page plays the
broadcast, which is the only way anyone hears the server's engine.

The client sends what it always sends: its hello, its watches, a project now and then. The player
drops everything that is not the transport or a visitor's mix. The allowlist is the backend's,
because a page can be edited; nothing on this side is trusted to hold back.

## The canned routes

A share is a folder of JSON and the files its engine plays. `/tree`, `/hints`, `/commands`, `/io-ports`
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

`/project-errors` returns "no errors", and that is an answer rather than a stopgap: a share is
made from a project that compiled, by the machine that compiled it.

## The address is a `base`, and that is all

`cfg().base` is a string set once. Nothing requires a file service to answer behind it, so the
media library serves the same GET shapes from the share and k7 does not notice.

The one seam to adjust is the NAME: `fget` asks for `/project-doc` because that is the file
service's route, and the share calls the same bytes `project-doc.json` because a file needs a
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

## Mute and solo are the visitor's, and reach only their session

Normally they are WRITES: `m` rewrites the track's bypass in `graph.k7x` and `s` the `soloed:` list
in `project.k7x`, because a mute is a decision about the song and not a session flag. On a share
there is nowhere to write, and `fsend` would refuse. So `useTrackControls` takes a `local` mode in
which the optimistic state IS the value. `App` sends that state to the player as a `track-mix`
(`EngineClient.trackMix`), and the player rewrites the visitor's own copy of the document. Another
visitor of the same link hears their own mix.

It is sent on a **change** only. The controls are rebuilt on every frame that moves the armed set,
and the player drops a visitor's messages past its rate. A new socket is a new session holding the
document's own mix, so a reconnect sends the mix again.

`arm` is untouched and stays a command: nothing records on a share, and the refusal that says so is
better than a button that pretends.

## Comments: the one write, and the one panel

A share is read-only, and a **comment** is not an exception to that: it changes nothing of the
project. It is a block of text beside the share, with an optional timecode — where the playhead
was when it was written.

`CommentsPanel.tsx` is a **panel**, docked at the right beside the panes, and takes the fourth slot
in `rightPanel`. Not a pane: a pane is something the project declares, and this is not part of the
song. The footer's tab is the whole of what a visitor may write: a share has no mixdown to download,
since nothing is rendered to make one.

**It is the only write in this shell that does not go through `fsend`.** That is the sentence to
keep: the transport's refusal is what makes a share read-only, and nothing here weakens it. This
panel talks to the media library's public router directly, on the same base the documents are read from, and the file
service is not in the path at all. What bounds that route is
[apps/k7/backend/docs/media/comments.md](../../backend/docs/media/comments.md).

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
it would be the wrong secret to keep; moving it is the author's, and happens in k7's home page —
[projects.md](projects.md).

The panel does not poll. A share is read in one sitting, and a timer per open tab against a public
route is a cost the feature does not need; the list re-reads when the panel is opened.
