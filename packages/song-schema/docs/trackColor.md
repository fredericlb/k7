# A track's category, and its colour (`src/trackColor.ts`, `trackCategory` in `src/trackKind.ts`)

Seven categories, in the order a song is laid out and each with one hue:

| category | colour | what falls in it |
|---|---|---|
| `vox` | pink | the `vo` and `ch` prefixes, and names saying vox, voice, voix, chant, choir… |
| `drums` | red | `da`, `ds`, and drum, kit, kick, snare, perc, 505/808/909… |
| `bass` | brown | `be`, `ba`, `bs`, and bass, basse, sub |
| `guitar` | green | `ge`, `ga`, and guitar, gtr, folk, strat, amp… |
| `keys` | blue | `pi`, and piano, keys, wurli, rhodes, organ, clav… |
| `synth` | purple | `sy`, and synth, poly, pad, arp, juno, the Mutable Instruments modules… |
| `other` | grey | `sx`, and anything that says none of the above |

## Where a category comes from, in order

1. **The prefix**, when the name declares one: the author said it, nothing argues.
2. **The name's own words**, for the many tracks an import or a quick take names `basse` or
   `acoustic_drums_kit_ludwig`. Drums are tested first, since "acoustic drum kit" is a kit before it
   is anything acoustic.
3. **The instrument**, when the name says nothing (`audio_7`, `michel`): the compiled lane's
   instrument, then its other modules — a `@st0/instruments/keys/…` ref, an SFZ kit, a Surge patch, a
   guitar amp. Only the compile and the commands have this; a view with just a name stops at 2.
4. **`other`**, and grey.

## Several of one category

They take SHADES of its hue, stepped across a lightness span chosen per category and nudged a few
degrees in hue, so two guitars are both plainly green and still plainly two. A single track sits in
the middle of its span. Which shade goes to which track follows the lane order, so the lightest and
darkest do not swap places between two compiles.

## Default, and `track arrange`

A track whose file states no `color:` is drawn in its category's shade — computed at compile, so
every surface sees the same one. A stated colour always wins: it is the author's.

`track arrange` is how a project gets the scheme when its tracks already have colours (an Ableton
import brings its own): it writes every lane's colour and states the whole `trackOrder`, vox first
and the rest last, stable within a category. One command, so one undo puts it all back.
