# Highlight — a lane pushed forward from the mixer

The strip's `+10` button plays its lane **10 dB louder** while it is on, and leaves everything else
as it was: the fader, its value, the rest of the mix. Several lanes can be highlighted at once. It is
for hearing one part in the mix without touching the balance that was set.

## Project state, beside `soloed:`

The highlighted lanes are a list at `project.k7x`'s root, `highlighted:`, written by `track highlight
<lane>` (a toggle) — the place and the shape `soloed:` already has, and for its reason: it is a fact
about how the song is being LISTENED to, kept across a reload and shared with whoever opens the
project, and never a value of any module. A lane split into an audio and a MIDI half is one entry.

## On the strip's output stage, not on its fader

The fader cannot carry it: the engine's strip stops at +6 dB, as Tracktion's fader does, so +10 on a
fader near unity would be clipped, and writing it there would change the value the person set. The
boost goes on the strip's **output stage** instead — the engine's `@output-volume` around any plugin,
which reaches +12 dB (`engine/k7-runtime/docs/mix.md`). The compile adds it to the lane's last mixer,
on top of whatever level that stage already had, and only in the document the engine is sent
(`highlight.ts`); the mixer's own params on disk are untouched, so switching it off returns the mix
exactly as it was. The compiled track carries `highlight: true` for the button to light.

The button is the mixer panel's `@highlight` bind, read as the LANE's control on the strip it is the
fader of — as a lane card's mute and solo are its lane's — and toggled through the same path.
