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

## The node draws a TAP per sound

The synthesised panel is a `tap` per sound (`TapWidget` in `@studio/ui-chains-react`): the pad, the
note under it, the sample's name, and a last tap that ADDS one. The pad is the pad below — it
auditions and it lights exactly as one did. The note is typed; the sample opens the host's picker,
the libraries' `samples/` as its choices (`withLibraryChoices`, handed only to a rack's step). The
widget only ASKS: every edit is a `node tap` command the host runs, so the card holds no state and
the command bar can do everything it can.

A rack with NO sounds still draws its panel — just the add tap — because a kit node is born empty
and that tap is how it gets its first sound. The taps are laid out in NOTE order, the order a kit is
played in, rather than by name.

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

The host decides how a pad is made audible (`onTriggerRack`), and st0 sends it through `preview` —
the same route the editor's gutter ▶ uses: the file service resolves the clip or the slice window
and the engine auditions it through a hidden one-shot sampler.

**So what you hear is the sample, dry.** Not the reverb, the EQ or the mixer that follow the rack
in its chain. That is a real limit and it is deliberate: the engine has no verb for sounding one
note of a *loaded* plugin — its whole client vocabulary is transport, params, preview and
plugin listing — so playing it in place would mean a new protocol message and its C++ side. The
audition route exists, end to end, and answers "which sound is this?", which is what a pad is for.

Every st0 pane that draws a kit — the chains pane, the graph panel, a lane's module row — plays it,
through one hook (`apps/st0/frontend/src/hooks/useRackTrigger.ts`): a pad that sounds in one and is
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
can answer the question itself — `apps/st0/frontend/src/rackLit.ts` turns the lane feeding a rack's
chain into a list of `{ from, to, key }` in arrangement beats, and each frame asks which of them
contain the playhead.

**What that costs, and it is worth knowing before trusting a dark pad:**

| | lights? | why |
|---|---|---|
| a sequence in the project | yes | its notes are in the compiled doc |
| a live MIDI input | **no** | those notes were never written down |
| a strudel lane | **no** | the engine makes them as it plays; the browser never sees them |
| accuracy | ~50 ms | the state frame's own rate |

A very short note is floored to `MIN_FLASH_BEATS` **on the display only**: a thirty-second drum hit
is a handful of milliseconds, and a pad lit for less than a frame flashes on some passes and not
others. What is played is untouched.

Observing it properly means the engine broadcasting its sounding notes — a change to the state
frame and its C++ side, on the hottest path there is. That is the trade this took; the derivation
costs nothing at the engine and is exact for the case a rack is normally used in.

### It reaches the pad through a store, not a prop

`RackLitStore` is subscribed **per pad**, exactly as `PluginParamsStore` is per param and for the
same measured reason: a prop carrying this would re-render every node in the graph on every frame.
The hook returns a boolean, so `Object.is` ends the render at the one pad whose note changed — and
`LiveRackLit.set` wakes only the modules whose sounding set actually moved, so a playhead crossing
silence notifies nobody.
