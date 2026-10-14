# Racks, their taps, and the kit a node carries

A **rack** is a module that is a note→audio sampler rather than a plugin: `type: rack`, plus a
`rack:` block mapping short symbols to MIDI notes and material.

## The kit is the NODE's

A rack MODULE is the sampler; which note fires which sound is a **kit**, and a kit belongs to the
node. The same rack module is the drums of one song and a percussion shelf of another, and nothing
about that difference is the module's business — putting the sounds in the module would make every
new kit a new module, a folder copied to change twelve lines.

That needs no new field. A node already has its own file and the loader already reads a `rack:`
from it, merged over its module's **per symbol** (the rule below), so a node stating the whole kit
over a module stating none is the ordinary merge. What was missing was the editing: the `node tap`
verbs write the NODE's file — the selected alternative's when a set other than the first is on, the
same rule a knob follows (`alternatives.md`), which is what lets two sets be two kits.

An empty `rack:` — no value, `{}`, or a `symbols:` with nothing under it — reads as a kit stating
no pads of its own, the same as no `rack:` at all. It is what a hand-edit leaves after deleting the
last pad, and refusing it would make the node vanish from the graph over a blank line.

A kit can be kept and reloaded as a PRESET of its rack module — the `rack:` of a preset file,
which loads in place of the node's own taps and refuses a `@project/` sample (`userPresets.md`).

## A tap is a note and a library SAMPLE

Each sound is a **tap**: `{ note, sample }`, `sample` naming a file under a library's `samples/` as
`@<library>/<path>` (`libraryFiles.md`). Every sample lives there, even one only a single kit
uses, for the reason IRs do: a kit's sounds outlive the kit, and a sound filed inside the module
that first used it has to be copied to be used anywhere else. The loader resolves `sample` into the
same absolute `clip` the compile already hands the engine, so nothing downstream learned a new
word, and the name it was written with rides beside it for the picker.

`clip:` (a file in the module's own folder) and `rack_type: slice` (windows cut from one `source`)
still load: they are how racks were written, and `scripts/migrateRacks.ts` converts them — a slice
rack's windows cut into one file each, byte for byte, the kit moved into the nodes that play the
module, and a module no node plays converted in place so nothing is lost.

## …or a KIT's pads: `k7-rack`'s other engines

A sampled drum kit is better played whole — its velocity layers, round-robins and hi-hat choke are
the point of it — so it can be drawn as a rack without becoming one. `@k7-core/instruments/k7-rack`
is ONE module for every kit, each an ENGINE of it (`engines.md`): `samples`, the rack whose taps are
the node's, and every other engine an SFZ player (`params: sfz:`) naming its pads under `kit:`,
`<name>: <note>`. A node changes kit the way it changes
any engine — the header's dropdown, its values kept per kit — and a preset can name the kit it was
taken on. Engines rather than a module per kit, because a kit is a choice made on the node, not a
different instrument to go and find; and rather than bases, because a kit's file lives on the
ENGINE's machine (`@instruments/…`), not in a module's folder. The node draws a tap per pad, in note
order, exactly as a rack's. A pad is its NOTE:
clicking it plays the note through the node's own lane — the whole kit and the node's chain after it,
the piano roll's `note-preview` — not a file played dry.

**The default engine is a KIT, `naked-drums`**: a rack node made from the picker sounds at once,
where a `samples` rack is silent until somebody gives it samples. So everything that writes taps says
`engine: samples` outright — the rack builder's node, a rack preset (`sfz-to-rack.ts` writes it) —
since on the default a node's taps would not be what plays. **A node's taps survive a kit**: they stay
in its file and are set aside while a kit plays, which draws its own pads (`asEngine` in
`engines.ts`), so switching back to `samples` finds them as they were.

**A kit's level is set per kit, and drawn in a column beside its pads.** A rack's samples are normalised
one-shots, each near 0 dBFS; a sampled kit keeps the balance it was recorded with, its kick 10 dB and
more under that at a usual velocity, so beside a rack it read as broken rather than as quiet. Each
kit's engine sets the SFZ player's `Volume` so that its loudest hit at full velocity peaks at 0 dBFS —
the rack's level, measured, without clipping the hardest stroke — and that `Volume` is a knob right
of the pad grid, on every octave's tab, the one control a kit's pads leave nowhere else.

**Each pad has a gain of its own, in a row under it.** It is the SFZ player's `Key <note>` param, in
whole dB from -24 to +12, so a node writes it into its `params:` like any knob and keeps it per
kit like every other value. It is bound to the NOTE rather than the pad's name because the player
knows only notes; a kit's pads are fixed to their notes, so the two cannot drift apart. It is a real gain
and not a velocity: the sample layer and the timbre stay the kit's (engine docs/sfzPlugin.md).

**A pad can be MUTED, on either kind of rack.** The pad stays — drawn dimmed, its note and sample
kept — and only stops sounding, so a part can drop the hats for eight bars without losing them. The
two kinds keep it where each keeps its pads: a rack tap says `mute: true` in the node's kit (`node tap
mute`, a toggle), and the compile simply does not hand that sound to the sampler; a kit's pad is the
SFZ player's `Mute <note>` param, set on the node like its gain, and the player drops that note's
note-ons. A mute is not a gain at its bottom: unmuting brings the pad back at the level it had.

The pads are the KIT's, and only the kit's. No "+", no sample to pick, no note to retype, no pad to
remove: the notes are where the SFZ file put its sounds, and a node that remapped them would be a
second keymap over the first, which a drum part written for General MIDI would then miss. To play a
kit from other notes, change the kit.

```yaml
# k7-rack/engines/naked-drums/module.yaml
extends: "@engine/sfz-player"
params:
  sfz: "@instruments/naked-drums/Wilkinson Audio/Naked Drums/User/Naked Drums GM.sfz"
kit:
  Kick: 36
  Snare: 38
  HatClosed: 42
```

### A kit from an SFZ drum kit

`engine/k7-runtime/scripts/sfz-to-rack.ts` makes a rack kit out of a sampled one: each piece RENDERED
through the engine's SFZ player at one velocity, its silent tail trimmed, one file per piece under a
library's `samples/`, and a preset mapping each to its note. Rendered rather than copied, because a
sampled kit plays several microphones per hit — a close mic and the overheads at least — and the
sample has to be what the player sounds for that hit, not one of its microphones. What a rack cannot
keep is the rest of the kit: its velocity layers, its round-robins and its hi-hat choke, which is why
the full kit stays an SFZ instrument and the rack is the light, editable copy.

## A tap with a chain of its own

**A tap can leave by an output of its own, into a SUBCHAIN of the node's chain file**: the snare
through a reverb, the kick dry. The node says so in `tap_outs:`, a tap's name to a subchain's id,
on a rack's sounds and a kit's pads alike, and `node tap out <node> <tap> <subchain|none>` writes it.

```yaml
# chains/drums.yaml
steps:
  - { id: lane-drums, track: drums }
  - { id: kit-1, extends: "@k7-core/instruments/k7-rack", tap_outs: { Snare: snare-fx } }
  - to: [ { chain: MIX } ]
subchains:
  - id: snare-fx
    steps:
      - { id: snare-verb, extends: "@k7-core/audio/verb" }
      - to: [ { chain: MIX } ]
```

- **On the node, not in the subchain.** Which pad goes where is a choice made on the instrument,
  like its gain and its mute; and a node's item survives a graph edit as written, where a chain
  file is rebuilt from the graph on every one.
- **A subchain of the same file, and only one fed that way.** It is the parent's own, the scope
  every subchain has (`chainFiles.md`); a subchain RUN in place is a stretch of its parent, with no
  run of its own to be fed, and is refused. A route to anything else is refused by name, at the
  command and at the compile, rather than swallowing the tap.
- **A real output, not a copy.** The engine runs the instrument in a rack of its own and returns
  the tap's pair on the subchain's track (`engine/k7-runtime/docs/tapOutputs.md`): the routed tap
  leaves the main output, and the kit stays one instrument, its hi-hat choke included. Pairs are
  numbered in the order of the taps' names (`src/tapOuts.ts`), so a rebuild lands every tap where it was.
- **Drawn as a jack.** The node grows an output named after the tap, with a cable to the subchain
  (`packages/ui-chains/src/graph.ts`).
- **Edited from the tap.** A pad's **Edit chain…** opens a popin on its chain (k7's `docs/shell.md`),
  whose buttons are `node tap chain add|move|remove`: the first module makes the subchain and routes
  the tap, and the last one removed takes both away — a tap-fed subchain with no node feeds nothing,
  and the next graph edit would drop it and leave the route dangling (`packages/song-edit/src/tapChain.ts`).

## The node draws a TAP per sound

The synthesised panel is a `tap` per sound (`TapWidget` in `@studio/ui-chains-react`): the pad, the
note under it, the sample's name, and a last tap that ADDS one. The pad is the pad below — it
auditions and it lights exactly as one did. The note is typed; the sample opens the host's picker,
the libraries' `samples/` as its choices (`withLibraryChoices`, handed only to a rack's step). The
widget only ASKS: every edit is a `node tap` command the host runs, so the card holds no state and
the command bar can do everything it can.

A rack is drawn by octave, a tab each, its twelve notes as a 4×3 grid with the lowest at the bottom
left (`packages/ui-chains/docs/graphBuild.md`). A pad sits AT its note, the place a part plays it
from, and an empty cell is an add tap on that note (`node tap at`). A rack with NO sounds still
draws one octave of add taps, because a kit node is born empty and that is how it gets its first sound.

```yaml
# modules/instruments/kit/module.yaml
extends: instruments/drumrack     # a base may ship sounds; this adds and overrides per symbol
type: rack
rack:
  rack_type: samples              # each symbol names its OWN clip…
  symbols:
    SN: { note: 38, clip: snare }
    HH: { note: 42, clip: hat }
```

Two flavours. **`samples`** gives each symbol its own `clip`; **`slice`** cuts every symbol out of
one shared `source`, as a `[from, to)` window in seconds. The compiler flattens both into the same
`RackSoundDoc { symbol, note, clip, start, length }` — the engine is handed one `sampler` plugin
carrying that list, whichever way it was written.

`extends` merges **per symbol**: a kit extending a drumrack sounds its base's kick and its own
snare. That merged rack is the EFFECTIVE one, and it is what everything below means by "the
rack" — `resolvedRack` is the one function that answers it, asked by the compiler and by the
graph alike.

## The node draws a pad per sound

A rack node carries its sounds (`WebChainStep.rack`) and turns them into a widget grid: one
`button` per symbol, labelled with it, four to a row. Synthesised rather than authored, exactly as
a track node's mixer strip is, and for the same reason — the pads are not the module's opinion
about its panel, they are what it IS. Asking someone to also write a `ui.yaml` listing the sounds
would be asking them to keep two lists in step.

An **authored `ui.yaml` wins**: a rack with a hand-made panel has said what its node should show,
and a grid of pads bolted underneath would be the app overruling the file.

### `@rack:<symbol>` is an intrinsic that FIRES

The binds are `@rack:BD`, in the same family as a track's `@mute` — a node intrinsic the renderer
routes itself rather than a plugin param. But it is the one intrinsic that **sets nothing**: it
fires a sound and returns. That is why it has a `WidgetTarget` kind of its own instead of being a
module field that happens to be momentary — it has no value to read back, no address to write to,
and no optimistic override to place.

## Clicking one AUDITIONS the sample

The host decides how a pad is made audible (`onTriggerRack`), and k7 sends it through `preview` —
the same route the editor's gutter ▶ uses: the file service resolves the clip or the slice window
and the engine auditions it through a hidden one-shot sampler.

**So what you hear is the sample, dry.** Not the reverb, the EQ or the mixer that follow the rack
in its chain. That is a real limit and it is deliberate: the engine has no verb for sounding one
note of a *loaded* plugin — its whole client vocabulary is transport, params, preview and
plugin listing — so playing it in place would mean a new protocol message and its C++ side. The
audition route exists, end to end, and answers "which sound is this?", which is what a pad is for.

Every k7 pane that draws a kit — the chains pane, the graph panel, a lane's module row — plays it,
through one hook (`apps/k7/frontend/src/hooks/useRackTrigger.ts`): a pad that sounds in one and is
silent in another reads as a broken card. What it plays is whatever material the tap has — a library
sample, resolved onto a file by the loader, a clip, or a slice window — so an older kit's pads play
too.

**A right-click is the pad's menu**: change note, change sample, rename, remove, add one before, add
one after, each a `node tap …` command (`packages/commands/docs/verbs.md`). An entry still owing a
value — a note, a sample, a name — is handed to the command bar with the line written, where a sample
completes from the libraries' `samples/`.

A host that offers no `onTriggerRack` draws the pads and leaves them inert (`rackTriggerable` in
`Channels`), the same honesty the three writability flags beside it already carry: drawn and
read-only, never clickable-and-silent.

## A pad LIGHTS when the sequence reaches its note

And it is **derived, not observed**. The engine reports no notes: its live frame is
`{ playing, playhead, levels, inputLevels, armed, recordEnabled, waveform }` and nothing about a
sampler's voices. But the browser holds the arrangement and the playhead at the same time, so it
can answer the question itself — `apps/k7/frontend/src/rackLit.ts` turns the lane feeding a rack's
chain into a list of `{ from, to, key }` in arrangement beats, and each frame asks which of them
contain the playhead.

**What that costs, and it is worth knowing before trusting a dark pad:**

| | lights? | why |
|---|---|---|
| a sequence in the project | yes | its notes are in the compiled doc |
| a LOOPED event of one | yes | the doc states the window, not the passes: the notes inside `[loopStart, loopEnd)` are tiled across the placed length, as the engine plays them (`clipLoop`) |
| a live MIDI input | **no** | those notes were never written down |
| a strudel lane | **no** | the engine makes them as it plays; the browser never sees them |
| a pad CLICKED | yes, briefly | the click is the browser's own: the store flashes that pad (`FLASH_MS`), apart from the playback picture each frame replaces, so the next frame does not put it out |
| accuracy | ~50 ms | the state frame's own rate |

A very short note is floored to `MIN_FLASH_BEATS` **on the display only**: a thirty-second drum hit
is a handful of milliseconds, and a pad lit for less than a frame flashes on some passes and not
others. What is played is untouched.

Observing it properly means the engine broadcasting its sounding notes — a change to the state
frame and its C++ side, on the hottest path there is. That is the trade this took; the derivation
costs nothing at the engine and is exact for the case a rack is normally used in.

Every pane that draws pads owes them the same answer — the graph, the bottom panel and the per-track
view each build the store from the project and the graph; a pane that drew pads and built none would
light nothing, on playback as on a click.

### It reaches the pad through a store, not a prop

`RackLitStore` is subscribed **per pad**, exactly as `PluginParamsStore` is per param and for the
same measured reason: a prop carrying this would re-render every node in the graph on every frame.
The hook returns a boolean, so `Object.is` ends the render at the one pad whose note changed — and
`LiveRackLit.set` wakes only the modules whose sounding set actually moved, so a playhead crossing
silence notifies nobody.
