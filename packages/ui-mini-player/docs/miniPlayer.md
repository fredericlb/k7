# The bar, and nothing else

`MiniPlayer` is a **view**. It holds no `<audio>` element, no socket, no timer and no transport
state: `playing`, `position` and `duration` are props, and the three buttons are callbacks. The one
thing it keeps is where a scrubber being dragged is (below). The screens
that mount it play things that have nothing in common —

| | the médiathèque | k7's references | a release's page | a k7 project |
|---|---|---|---|---|
| what plays | a song of the médiathèque | a reference track in the workspace | a published version | the arrangement |
| through what | the engine, or this tab's `<audio>` while none answers | this tab's `<audio>`, always | this tab's `<audio>` | the engine, over its socket |
| beside what | nothing: it IS the screen's sound | the engine playing the project, unbothered | the waveform player it drives | a reference track, which keeps the system's controls |

— so a bar that owned a transport could serve exactly one of them. What is shared is the row: a
play/pause on the left, the title with whatever the host has to say about it, a clock either side
of a scrubber, the host's own controls, and a close top right.

## `clock` is exported, and it is the point of the file being shared

Two readings of one transport that round differently is a bug nobody reports and everybody sees.
One function, one bar.

## Every string is a prop

`labels` carries the five: the region's accessible name, play, pause, the scrubber and the close.
Not a default in English with an override — a default is what ships untranslated. The hosts
translate through their own catalogues (the médiathèque's bar is filled from `LibraryLabels`,
which its host fills in turn), so the bar must have no opinion.

## Three slots, because a title line is where hosts differ most

`meta` sits after the title (an artist, an album, a version badge), `status` closes the line (a
failure, or "ended"), and `children` sits right of the transport, before the close — where the médiathèque
puts its destination indicator and its queue button. All optional: a host with none of them gets
a bar that reads correctly with a title alone.

## Edge slots, and two that replace the bar's own transport

`lead` stands at the bar's left edge, outside its centred part: k7's project puts its way home and its
name there. A host whose name is in `lead` passes an empty `title`, and the title line goes; the system
still reads `title` when the session is on.

`trail` mirrors it at the right edge, and `end` follows `trail` behind a rule: k7's project puts its
pages in the first and its engine in the second. Two slots rather than one, because what plays and
where to go are two questions, and a host answering both in one row reads as one list.


`transport` stands where the play/pause button is, and `track` where the clocks and the scrubber are —
`null` for none at all. They are for a host whose transport is more than a range: k7's project has play,
stop, loop and record, and its "where" is bars and lanes, which it draws as a clock and a minimap; the
médiathèque draws the playing file's waveform (`packages/ui-library/docs/miniPlayer.md`), and leaves
`track` unset for a file it has no shape of, which gives the scrubber back. The row
around them — the title, the host's controls, the close — stays the bar's, so the shape still reads as
the same player. A host that passes them still passes `playing` and `onToggle`, which the system's
controls use.

## The play button's menu

`playMenu` puts the host's items behind the play button (`src/PlayButton.tsx`): a right-click, the
keyboard's menu key or a finger held still for half a second opens them, and a plain press only
plays or pauses. The play button is where the eye already is for what plays, and the row has no
room for one more button on a phone. The menu is anchored on an inert span over the button rather
than on the button itself, since a menu trigger opens on every press; the click that ends a long
press is swallowed, or lifting the finger would also toggle the transport.

`mediaSession={false}` leaves the system's session alone, for a bar whose sound is not this page's: two
bars on one screen must not fight over the lock screen. `onClose` is optional, and a bar without it has
no close.

## The scrubber is an `<input type="range">`

Not a div with a click handler. Dragging, the keyboard and the accessible name all come with it,
and a progress bar that cannot be scrubbed is one people try to scrub anyway. It is `disabled`
until a duration exists, since a range with no maximum is a control that lies about where you are.

**It seeks once, when it is let go** (`useScrub.ts`). A range fires `input` on every pixel of a
drag, and a host that seeks on each sends a burst of seeks — through the engine, say — that the far
end works through long after the finger has stopped. So while it moves the
bar shows the thumb's position locally, clock included, and `onSeek` is called on the release:
the pointer let go (anywhere, not only over the range), the native `change`, a key released, or
focus leaving. Each is the same idempotent commit, so a keyboard's arrows still seek, one step per
press.

**Its hit area is taller than its track.** The visible track is 4 px, drawn behind a range 20 px
tall — 32 px on a device without hover — so a finger finds it without the bar growing. The close
button grows to 40 px on such a device too, centred at the right with room made for it, while a
mouse keeps the small corner button.

**The track is always drawn**, the part not yet played included: a bar whose unplayed half is the
card's own colour reads as no bar at all until something plays. Played is the foreground; the rest
is the muted text colour, faded, which stays visible on both themes. Both come from the design
system's `--color-*` tokens, which are whole colours: a token wrapped in `hsl()` is invalid and draws
nothing.

**The bar's content is centred, at most 800 px wide**: the play button, the title, the position row
and the host's own controls. Stretched across a wide window they end up at opposite edges, the
clocks far from the bar they read, and a long drag is a longer one for nothing. The bar itself — its
background, its border — still spans the window, and the close stays in its corner, where a bar's
close is looked for.

## The dock

A host whose pages each mount a bar of their own, and which wants ONE row at its foot whatever the
page, wraps them in `MiniPlayerDock` and draws `MiniPlayerDockOutlet` where the row goes
(`src/dock.tsx`). A bar mounted anywhere inside is drawn in the outlet, through a portal, and takes
the dock's `lead` and `end` when it passes none — so the host's way back and its engine stand on
every bar without a page knowing them. A `standby` bar fills the outlet while no other is mounted:
the row never comes and goes, which is the point of a dock. A page that left room under its column
for a fixed bar asks `useMiniPlayerDocked()` and leaves none.

## The close is the only thing that takes the bar away

The component never hides itself: the host decides whether there is a bar at all, and a host with no
`onClose` keeps it for as long as it has something to drive. That is what
lets "what I have just heard" outlive the last sample — a track running out leaves the row up,
saying so through `status`, with the play button ready to start it again.

## The bar is also the system's media session

A phone shows what plays on its lock screen and in its notification shade, and a headset's
buttons pause it: that is what makes an app a media player to the OS, and the browser's Media
Session API is how a page becomes one. The bar fills it from its own props (`mediaSession.ts`),
so every host is a media player without doing anything — and the system's buttons call the same
`onToggle`, `onSeek` and `onClose` the bar's do, so the two can never drive different transports.

- **Two props the bar does not draw**: `artist` and `album` as plain text, since the system
  cannot show `meta`, which is a node; and `onNext`, the system's skip button, absent when the
  host has nothing to skip to.
- **The playhead is reported on a seek, a pause or a new length, not every frame.** The system
  extrapolates a playing position itself, and a host updating `position` sixty times a second
  would otherwise send sixty reports — across a bridge, on the Android app.
- **The session is cleared when the bar unmounts**, since a lock-screen control that outlives the
  player drives nothing.

The browser shows these controls only for a page that is itself making sound — the médiathèque
playing in the tab, a reference track. Playing on the engine, the page is silent, and
only the Android app, which relays the session itself, shows them then
(`engine/k7-runtime/docs/android.md`).
