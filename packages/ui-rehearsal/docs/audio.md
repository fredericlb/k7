# Audio in the rehearsal pages

What the pages do with sound: where a take is drawn, how it is played back, and how a release and a
page play theirs. Where the bytes are stored is the server's page
(`packages/rehearsal-server/docs/audio.md`); how a take is captured is the recorder's
(`packages/recorder/docs/recorder.md`).

## Where a new take opens

The take is held by `RehearsalRecording`, which k7 wraps around its home routes
(`apps/k7/frontend/src/appMain.tsx`), so a take survives going from a rehearsal page to the media
library, the projects or the settings and back. It has no route of its own and no dialog: it is
**one bar** at the bottom of the content column (`@studio/recorder`'s `docs/recorder.md`), from the
start of the session to its upload. It holds nothing until a take starts — no microphone, no engine —
so wrapping every home page costs them nothing; what it draws is a lazy chunk.

A take starts from the red dot k7 draws as the rehearsal pages' action (`NewSessionButton`), or
from resuming a session, and the page it starts on stays as it is: you may browse another page
while the tape rolls, and covering what you were reading is the one thing that use has no answer
to. A bar does not cover it, and its highlights, Resume and Stop are every
control a take needs. What starts the session (`SessionStartBar.tsx`) and the input a chain may ask
for are said in that same bar, before the recorder takes its place.

The bar stays inside the content column, never over k7's sidebar nor its home bar: the sidebar is
how you move between pages while the take runs. Being held above the routes, it is outside the
column, so it reads where it is from the host's `--host-column-left` and `--host-column-bottom`
(0 without a host), and the pages leave it room by its published height, `--rec-bar-h`.

## Drawing must not eat the audio

The waveform canvas is redrawn whenever the envelope's identity changes, hence the memoised
object: an envelope recreated on every render redraws on every playhead tick.

The **playback playhead is a DOM layer**, not a stroke on the canvas: following it at 60 fps with a
full redraw allocates enough for the garbage collector to cause an audible hiccup.

When a session is extended the waveform shows the old take **in front of** the new: the display
timeline is offset by the length of the existing envelope, so the two stretches meet edge to
edge. The recorder's own timeline — detected moments, listening, pending annotations — stays
relative to the new take.

## Two sources, one recorder

This device's microphone, or the account's rehearsal chain played on k7's bench
([chainSource.md](chainSource.md)), picked in the New session button's menu; which chain that is
is chosen on k7's Frozen chains page, never here. Each
reaches the recorder as a `MediaStream`, so the waveform, the moments and the upload are the same
whatever the source.

## Releases and pages: one player

A release and a page draw their audio the same way — the shape measured on the server, the same
one component (`WaveformPlayer`), because "a shape that seeks, and a button that stops" is one idea
and not two.

**Every version and every page entry gets its own player**, so a list mounts many of them. Each
one loads its audio only on the first play (`preload="none"`): a page of ten releases must not
pull ten masters before anyone presses play. The shape still loads on mount, and a spinner stands
where the shape will be, then on the button while the audio buffers. **One track plays at a
time**: starting one pauses the one before, because two masters at once is never the point.
