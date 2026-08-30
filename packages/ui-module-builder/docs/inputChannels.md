# Pointing an input at a socket

> The **graph** answers this too, and differently: a live input's node draws the same three
> choices as dropdowns, built by `inputUI` in `@studio/ui-chains` and written by
> `node param <node> @channel …`. There the socket is a PARAMETER of the node exactly as
> `@monitor` is — one verb for every control a module has, the `@` saying it is the module's
> own field rather than a plugin's (`packages/song/docs/intrinsics.md`) — which is what lets a
> built-in module carry its own panel; see that package's `docs/graphBuild.md`. This page is
> about the strip in the editor and the builder, which edit the file's text directly.

An `io: in` module is the one kind the builder edits that runs no plugin. The input **is**
the module, so its panel has no scanned parameter list — `IO_IN_BINDS` gives it `@gain` and
`@monitor` to bind — and it has one question no plugin module has: *which of the interface's
inputs am I?*

The bar under the left column's pane answers it by picking, rather than by typing `channel:`
into the file. Under whichever pane is up, because it belongs to the module rather than to any
one of them — the parameter list is a tab, so it is not the thing to hang the bar off.

## A module rarely SAYS it is an input

`nodes/ge_rythm-in.yaml`, from a real song, is two lines:

```yaml
extends: "@engine/IN"
channel: [ 2 ]
```

No `io:` anywhere. So `ioOf` resolves three sources in order — the file's own key, an
`extends` naming one of the engine's io modules (`IO_MODULES`, a fixed table and not files),
and failing both the path, since a file under `io/IN/` is one of that folder's inputs and
that is how the loader decides it too. Reading only the first calls this an ordinary plugin
and costs it both its io binds and this bar.

## The sets are the engine's, not a range of numbers

The obvious implementation is a spinner from 1 to however many inputs the card has. It is
wrong, and silently so:

> `channels` is 1-based and is the set `findWaveInput` matches EXACTLY: a rig that pairs its
> inputs has no device for channel 2 alone, so asking for it resolves to nothing and reads as
> silence. Anything offering a choice of input has to offer these sets and not raw numbers.
>
> — `EngineInputDevice`, `@studio/engine-browser`

So every option in the dropdown is a device the engine declares, and picking one writes that
device's own `channels` array verbatim.

## Why mono/stereo is not a filter

A filter is useless on a real rig: a Focusrite 18i20 enumerates **twenty mono inputs and no
stereo device at all**, so a stereo list filtered out of that is empty for ever.

The toggle therefore **regroups**. In stereo it offers the pairs the interface *could* be
asked to become — two mono devices sitting on one hardware pair — and choosing one asks the
engine to merge them (`setInputStereo`, which reaches `DeviceManager::setDeviceInChannelStereo`)
before writing `channel: [1, 2]`. In that order: the write names a set that has to exist for
it to mean anything. Mono offers the reverse, splitting a pair back into its two channels.

Two consequences that are the interface's and not ours:

- **Pairs are even/odd hardware channels only.** 1 with 2, 3 with 4. There is no pairing of
  2 with 3 to offer, however reasonable it looks written down — Tracktion's
  `describeStandardDevices` walks its channel list two at a time. `inputOptions` never
  synthesises one, and a test pins that.
- **Regrouping destroys the other arrangement.** Pairing 1+2 merges two device names into
  one, and a device is identified by its name — so a module still saying `channel: [2]`
  matches nothing and goes silent, with no error anywhere. The bar says so in amber *before*
  the act, not after.

The grouping is remembered in `<state>/preferences.yaml` (`inputPairs`) and replayed to the
engine on every connect, exactly as the audio device is. Tracktion persists a copy of its own
and it is unreadable in practice — the only call that loads it also reopens the remembered
interface, which `engine/moteur/AGENTS.md` forbids — so without this the pairing lasts until
the next engine restart and then silently reverts, taking the module's sound with it.

### Both halves are one COMMAND

`system channel type <channel> <mono|stereo>`. The host passes `onRegroupInputs`, st0 dispatches
that line, and the two writes above happen on the service's side — the preference first, so a rig
that answers slowly still remembers what was asked of it.

One command and not an engine message on the shell's own socket **plus** a write through a file
route: that would be one act with two doors and no name, so nothing in the palette could pair two
inputs and nothing in the log would say anybody had. A host with no engine attached still gets the
durable half and is told so, rather than a refusal for an act that is already recorded.

What is left on the surface's side is asking the engine what the interface BECAME — `ioLevels([])`,
once the command has been through, since the engine sends nothing back for the change itself.

## A label is left a label

`channel:` has two spellings. A list of numbers is the rig's channels directly; a **string**
is a name from the machine's preferences, resolved by `resolveInput` in `@studio/song`. This
package holds no preferences and cannot resolve one, so `channelOf` returns the label as
written and the bar shows it as the current value. Picking a device replaces it with numbers —
a deliberate act — but nothing rewrites a rig's own naming just because somebody opened the
module.

## Where the list comes from

`inputDevices` and `onRegroupInputs` are **props**, for the same reason `pluginParamNames` is
one: which inputs exist, and what they can be regrouped into, is a question only the machine
holding the sound card answers. st0 fills them from `useInputDevices`, which asks
`ioLevels([])` while the builder is open — an empty set list, because metering a channel
*enables* it engine-side and the grouping is all that is wanted — and re-asks after a
regroup, since the engine broadcasts no second copy of the layout.

A host with no engine (the médiathèque draws this builder too) passes no `onRegroupInputs`
and gets only the grouping that already exists. An option that quietly did nothing would be
worse than a shorter menu.
