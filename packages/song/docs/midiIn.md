# A MIDI device — the node a lane records notes from

A MIDI keyboard is an **io module that emits MIDI**, declared in `graph.yaml` like any other node:
`@meta/MIDI`, made with `node new io/MIDI <name>` or the graph's `+` (inputs › MIDI input). It is to
notes what a live audio input is to a sound, and what a camera is to a picture: signal comes FROM it,
it has no plugin, and every control it has is a field of its file.

```yaml
# nodes/keys.yaml
extends: "@meta/MIDI"
device: "Arturia KeyStep 37"
```

```yaml
# graph.yaml
modules:
  keys: [ lead ]          # this lane records from that keyboard
```

## The cable is what says which lane records it

Recording MIDI is the BROWSER's job — it is where the keyboard is plugged in, and the engine's
machine may be elsewhere (`apps/k7/frontend/src/webmidi.ts`). The lane a take lands on is the armed
one; the DEVICE it listens to is the one named by the midi-in node wired to that lane
(`midiInDeviceFor`). So a rig with two keyboards records each into its own lane by drawing two
cables, and a choice made once in the graph does not have to be made again at the transport.

**An armed lane is PLAYED as well as recorded.** Each channel message from its keyboard goes to the
engine as it arrives (`midi-live`, engine/k7-runtime/docs/protocol.md), so the lane's instrument
sounds under the fingers whether or not a take is rolling. Only the armed lane hears it: a rig of
two keyboards on two lanes does not play both instruments from either. The card's LED, by contrast,
lights for ANY channel message from its device, armed or not, since what it answers is "is this
keyboard reaching the browser at all" (`apps/k7/frontend/src/midiActivity.ts`).

**The cable is also what makes a lane armable for MIDI.** A lane a midi-in node feeds arms in the
browser even while it holds no sequence, since an empty lane is exactly where a first take goes.
Every take then becomes a new sequence — on an empty lane and a full one alike, as every audio take
is a new clip — sized to whole bars around the notes and placed where they were played (`sequence record`, `packages/commands/src/verbs/sequenceRecord.ts`): one command, so
the take is one undo. Arming it in the engine instead would be refused, because the engine arms
only a lane with an audio input.

**No node, no MIDI.** A lane no midi-in node feeds records no notes, and starting a take on one says
so rather than capturing every keyboard on the machine. A global "any input" default would make the
graph and the take disagree about where the notes came from.

## Why the LABEL, and "" for any device

`device:` names the keyboard the way a person does, not by the Web MIDI port id, for the camera's
reason ([camera.md](camera.md)): an id is per browser and does not travel with a project. The browser
matches it exactly, then case-insensitively, then by containment (`matchMidiDevice`). An empty or
absent `device` records from every device — a one-keyboard rig need not name it.

The card's dropdown lists the inputs this browser sees, with `any` first so a choice can be undone
without editing the file; it writes `node param <node> @device <label>`. A project with a midi-in
node asks for MIDI access when it opens, so the list is there before anyone records, and asks
again on every press of a dropdown: Firefox grants Web MIDI by installing a site-permission
add-on, and the request made while that install runs fails, so a single ask at open would leave
the list empty until a reload. Once access is granted the repeat costs nothing and re-lists.

## The engine is handed nothing

A midi-in node compiles to nothing: no input channel, no plugin, no track of its own. Its cable onto
a lane is legal — the one other source, beside a live audio input, that may land on one
(`carriesMidiIn` in `graph.ts`) — and a cable INTO it is refused, notes coming from a keyboard and
never to one.
