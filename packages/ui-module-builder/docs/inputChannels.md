# Pointing an input at a socket

An `io: in` module is the one kind the builder edits that runs no plugin. The input **is**
the module, so its panel has no scanned parameter list — `IO_IN_BINDS` gives it `@gain` and
`@monitor` to bind — and it has one question no plugin module has: *which of the interface's
inputs am I?*

That question used to be answerable only by typing `channel:` into the file. The bar above
the params pane answers it by picking.

## The sets are the engine's, not a range of numbers

The obvious implementation is a spinner from 1 to however many inputs the card has. It is
wrong, and silently:

> `channels` is 1-based and is the set `findWaveInput` matches EXACTLY: a rig that pairs its
> inputs has no device for channel 2 alone, so asking for it resolves to nothing and reads as
> silence. Anything offering a choice of input has to offer these sets and not raw numbers.
>
> — `EngineInputDevice`, `@studio/engine-browser`

So the dropdown lists what the engine **declares**, by name, and writes back that device's
own `channels` array verbatim. Nothing here composes a set of its own.

## What mono/stereo actually does

It **filters** the declared sets by width — one channel or two — rather than pairing numbers
up. This follows from the rule above: a stereo entry the interface never declared is a set
`findWaveInput` will not match, which is the failure the rule exists to prevent. On a rig
that enumerates both its pairs and their halves (the common case) the toggle reads exactly as
it looks; on a rig that only pairs, the mono list is empty and the bar says so in amber
instead of offering choices that would resolve to silence.

The toggle starts on whatever the module already declares — two channels means stereo — so
opening an input shows the list it belongs to without being told.

## A label is left a label

`channel:` has two spellings. A list of numbers is the rig's channels directly; a **string**
is a name from the machine's preferences, resolved by `resolveInput` in `@studio/song`. This
package holds no preferences and cannot resolve one, so `channelOf` returns the label as
written and the bar shows it as the current value. Picking a device replaces it with numbers —
a deliberate act — but nothing rewrites a rig's own naming just because somebody opened the
module.

## Where the list comes from

`inputDevices` is a **prop**, for the same reason `pluginParamNames` is one: which inputs
exist is a question only the machine holding the sound card answers, over its socket. l8
fills it from `useInputDevices`, which asks `ioLevels([])` once while the builder is open —
an empty set list, because metering a channel *enables* it engine-side and the grouping is
all that is wanted. The engine builds `devices` from the card either way. With no engine
attached the list is empty and the bar says so; that is the honest answer, not a failure.
