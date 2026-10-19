# The desk's files

A desk is described by two files in the project: `surfaces/desk.k7x`, which says what the desk is and what each control moves, and `mix.k7x`, the cue sheet the desk writes as you set cues. A new mix project creates both. This page is the reference for each.

## `surfaces/desk.k7x`

The file name (without `.k7x`) is the surface's id; a mix project names it `desk`. A project can declare only one `turntables` surface.

```k7x
type("turntables")
layout("split")
playlist("ete-2026")
stems(true)
mapping({
  crossfade: { module: "fadeA", param: "Level", invert: true, also: { module: "fadeB", param: "Level" } },
  "deckA.tempo": { module: "tempoA", param: "Target BPM" },
  "deckA.trim": { module: "trimA", param: "Trim" },
  "deckA.eqLow": { module: "eqA", param: "Low-shelf gain" },
  "deckA.eqMid": { module: "eqA", param: "Mid gain 1" },
  "deckA.eqHigh": { module: "eqA", param: "High-shelf gain" },
  "deckA.filter": { module: "filterA", param: "Sweep" },
  "deckA.level": { module: "levelA", param: "Gain" },
  "deckA.cue": { module: "cueA", param: "Level" },
  "deckA.echo": { module: "echoA", param: "@mix" },
  "deckA.stemDrums": { module: "platterDrumsA", param: "Gain" },
  // ...the same for deckB
})
```

### Fields

| Field | Required | Meaning |
|---|---|---|
| `type` | yes | `turntables`. |
| `layout` | yes | `split`: the desk is a pane. It is the only layout a `turntables` surface accepts; anything else is refused with "a 'turntables' surface draws in 'split'". |
| `playlist` | no | The playlist the song browser lists, by **name** under the workspace's `_playlists/` folder: `ete-2026` means `_playlists/ete-2026.k7x`, `live/repet` means `_playlists/live/repet.k7x`. Only a `turntables` surface may carry it. |
| `stems` | no | `true` lets the desk **separate** a song put on a deck that has not been separated yet. Off when absent: a separation costs minutes and only happens when asked. Only a `turntables` surface may carry it. |
| `mapping` | in practice | Which module parameter each desk control drives. Without the required controls the desk is not drawn. |

Any other key is refused.

### Writing a mapping line

Each line is keyed by the **control id** and names:

| Key | Meaning |
|---|---|
| `module` | The **node name** as the graph writes it (`tempoA`, `eqA`), not a media-library reference. A set uses the same module several times, and only the node name tells them apart. |
| `param` | The parameter, spelled as the module's panel binds it. |
| `invert` | Optional. `true` mirrors the control within its own range before writing. This is what turns two fades into one crossfader. |
| `also` | Optional. One second target (`module`, `param`, optional `invert`) the same control drives. A control drives at most two parameters. |

`null` is a valid value: it means the control is not wired yet. `project surface new turntables` writes every control as `null` with a comment saying what kind of module it wants.

Two controls may name the same parameter; both move it.

### Control ids

Controls marked **required** must be mapped before the desk draws; until then it shows a list of "Le composant … de cette vue n'est pas mappé à un module" with the fix. The others are optional: an unwired optional control is simply not drawn or greyed.

| Control id | Required | Kind | Range | Rest | Wants |
|---|---|---|---|---|---|
| `crossfade` | yes | fader | 0 to 1 | 0.5 | a crossfade (two fades) |
| `deckA.tempo` | yes | fader | 10 to 300 BPM | song's own | a tempo module |
| `deckA.trim` | yes | fader | −12 to +12 dB | 0 | a trim |
| `deckA.eqLow` | yes | fader | −20 to +20 dB | 0 | an EQ |
| `deckA.eqMid` | yes | fader | −20 to +20 dB | 0 | the same EQ |
| `deckA.eqHigh` | yes | fader | −20 to +20 dB | 0 | the same EQ |
| `deckA.filter` | yes | fader | −100 to +100 | 0 | a filter |
| `deckA.level` | yes | fader | −60 to +6 dB | 0 | a level (gain) |
| `deckA.cue` | no | button | 0 or 1 | 0 | a headphone send |
| `deckA.echo` | no | fader | 0 to 1 | 0 | an echo |
| `deckA.stemDrums` | no | fader | 0 to 2 | 1 | a stem platter |
| `deckA.stemBass` | no | fader | 0 to 2 | 1 | a stem platter |
| `deckA.stemOther` | no | fader | 0 to 2 | 1 | a stem platter |
| `deckA.stemVocals` | no | fader | 0 to 2 | 1 | a stem platter |
| `deckA.sync` | no | button | 0 or 1 | 0 | |

Every `deckA.…` id exists for `deckB` as well. `transport` and `listen` are also known ids, for hosts that offer them; k7's desk does not draw them.

A line naming a module or parameter the project does not have is reported on the desk by control, with its message.

### What a new set wires

| Control | Node | Module it extends | Parameter |
|---|---|---|---|
| `crossfade` | `fadeA` (inverted) and `fadeB` | `@k7-core/audio/utility/fade` | `Level` |
| `deckX.tempo` | `tempoX` | `@k7-core/cold/tempo` | `Target BPM` |
| `deckX.trim` | `trimX` | `@k7-core/audio/utility/trim` | `Trim` |
| `deckX.eqLow/Mid/High` | `eqX` (engine `tracktion`) | `@k7-core/audio/eq` | `Low-shelf gain`, `Mid gain 1`, `High-shelf gain` |
| `deckX.filter` | `filterX` (engine `sweep`) | `@k7-core/audio/filter/multimode` | `Sweep` |
| `deckX.level` | `levelX` | `@k7-core/audio/utility/gain` | `Gain` |
| `deckX.cue` | `cueX` | `@k7-core/audio/utility/fade` | `Level` |
| `deckX.echo` | `echoX` (engine `echo`) | `@k7-core/audio/delay` | `@mix` (the engine's dry/wet around the delay) |
| `deckX.stemY` | `platterYX` | `@meta/audio/turntable` | `Gain` |

The **tempo** module is an offline ("cold") module: it reads a deck's whole file before playback. Moving the tempo fader re-sends the project to the engine a few times a second while you drag, and once more when you let go. The other controls move a live plugin parameter at every step.

### Adding an echo or stems to an older set

A desk with no `deckA.echo` line draws no ECHO knob and greys the echo-out button; a desk with no stem lines draws no stem knobs. Both are complete desks. To add them, give the project the nodes (see the graph in a new mix project for the wiring) and add the mapping lines.

## The cue sheet: `mix.k7x`

`mix.k7x` at the project root stores the hot cues this set has set, song by song. **The desk writes it**: hold a cue button and the line appears. It is there to be read, corrected and kept, not filled in by hand.

```k7x
cues([
  ref("@k7-core/songs/AC-DC/Back in Black/Hells Bells").markers([12.5, null, 48.25]),
  "@k7-core/songs/Other/Album/Title",
])
```

| Field | Meaning |
|---|---|
| `cues` | A list. Each entry is a song reference alone, or a mapping with `ref` and `markers`. |
| `ref` | `@k7-core/` followed by the song's media-library id, `songs/<artist>/<album>/<title>`. Quote it, like every string. |
| `markers` | Up to eight positions, one per cue button, in **seconds into the file**. `null` is an empty button. Position 0 is button 1. |

Cues are in seconds of the file and not of the playback clock, so a cue stays on the same note whatever tempo the deck plays at. A cue belongs to this set rather than to the song: two sets that play the same song keep their own cues. The tempo and key of a song do not belong here; they live with the song in the media library.

If the desk could not read `mix.k7x`, it refuses to write a cue rather than overwrite the file, and says "mix.k7x could not be read yet — the cue was not written".
