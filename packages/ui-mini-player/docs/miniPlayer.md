# The bar, and nothing else

`MiniPlayer` is a **view**. It holds no `<audio>` element, no socket, no timer and no state:
`playing`, `position` and `duration` are props, and the three buttons are callbacks. The two
apps that mount it play things that have nothing in common —

| | pl8 | st0 |
|---|---|---|
| what plays | a song of the médiathèque | a reference track in the workspace |
| through what | this tab's `<audio>`, mpv on the host, or the engine | this tab's `<audio>`, always |
| beside what | nothing: it IS the app's sound | the engine playing the project, unbothered |

— so a bar that owned a transport could serve exactly one of them. What is shared is the row: a
play/pause on the left, the title with whatever the host has to say about it, a clock either side
of a scrubber, the host's own controls, and a close top right.

## `clock` is exported, and it is the point of the file being shared

Two readings of one transport that round differently is a bug nobody reports and everybody sees.
One function, one bar.

## Every string is a prop

`labels` carries the five: the region's accessible name, play, pause, the scrubber and the close.
Not a default in English with an override — a default is what ships untranslated. The hosts
translate through different catalogues (st0 compiles paraglide messages, pl8 writes French in the
component), so the bar must have no opinion.

## Three slots, because a title line is where hosts differ most

`meta` sits after the title (an artist, an album, a version badge), `status` closes the line (a
failure, or "ended"), and `children` sits right of the transport, before the close — where pl8
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
