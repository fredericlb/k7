# The bar, and nothing else

`MiniPlayer` is a **view**. It holds no `<audio>` element, no socket, no timer and no state:
`playing`, `position` and `duration` are props, and the three buttons are callbacks. The two
screens that mount it play things that have nothing in common —

| | the médiathèque | st0's references |
|---|---|---|
| what plays | a song of the médiathèque | a reference track in the workspace |
| through what | this tab's `<audio>`, mpv on the host, or the engine | this tab's `<audio>`, always |
| beside what | nothing: it IS the screen's sound | the engine playing the project, unbothered |

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

## The scrubber is an `<input type="range">`

Not a div with a click handler. Dragging, the keyboard and the accessible name all come with it,
and a progress bar that cannot be scrubbed is one people try to scrub anyway. It is `disabled`
until a duration exists, since a range with no maximum is a control that lies about where you are.

## The close is the only thing that takes the bar away

The component never hides itself: the host decides whether there is a bar at all. That is what
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
playing in the tab, a reference track. Playing on mpv or the engine, the page is silent, and
only the Android app, which relays the session itself, shows them then
(`engine/st0-engine/docs/android.md`).
