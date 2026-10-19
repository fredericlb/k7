# Working with a node

Every module card in the chains view carries its panel: the knobs, faders, switches and screens
its module declares. This page covers playing those controls and the other settings a node
carries: presets, engines, alternatives, bypass, freeze, MIDI control and rack pads.

## Controls

| Control | How to use it |
|---|---|
| Knob, slider, fader | Drag. Hold **Shift** while dragging for fine steps. **Double-click** to type a value: `Enter` or clicking away commits, `Esc` cancels. |
| Number | Drag or double-click to type, like a knob. |
| Toggle | Click to flip. |
| Button | Click: it sends 1 and then 0. |
| Dropdown | Pick one of its named settings. |
| File picker | Opens the asset browser for a file the module loads (an amp model, an impulse response, a sample). |
| Meter, waveform, LCD screen | Display only, unless the screen was written to react to the pointer. |

A value you drag is heard live and written into the node's file when you let go. Controls on a
card with tabs are spread over several pages; click a tab to change page.

Some knobs are a **crossfade** between a dry and a wet parameter: turning it moves both.

### Stage controls

Under the panel, a card's footer can carry three controls the engine adds to every module,
whatever plugin it hosts:

| Parameter | Range | Offered on |
|---|---|---|
| `@input-volume` | -60 to +12 dB | audio effects |
| `@mix` | 0 to 1 (dry to wet) | audio effects |
| `@output-volume` | -60 to +12 dB | every module |

### Setting a value by command

```text
node param synth "Filter Freq" 69
node param amp @mix 0.4
```

`node param` sets a plugin parameter, an `@` setting, or a file the node carries.

## Bypass

The on/off block in a module's header bypasses it: the sound passes through untouched. Click it
again to re-enable. A lane's mixer strip has no bypass; use mute. By command:
`node bypass <node> [on|off]` (with no state it toggles).

## Presets

The preset dropdown on a card lists the presets of the node's module. The arrows beside it load
the previous and next preset. The preset picker can also **save** the node's current values as a
new preset, and **update** the last preset loaded.

A preset is kept either in the **workspace** or in a **library**. The scope is part of its
address.

| Command | Example |
|---|---|
| `node preset apply <node> [scope] [name]` | `node preset apply lead workspace "warm pad"`. With no preset, it lists them. |
| `node preset save <node> <name> [scope]` | `node preset save lead "warm pad"`. The scope defaults to `workspace`. |
| `node preset update <node> <scope> <name>` | Overwrite an existing preset with the node's current values. |

A preset name uses letters, digits, spaces, `_` and `-`, up to 64 characters. Saving to a library
requires the right to edit that library (see [Libraries](./44-libraries.md)).

## Engines

Some modules hold several **engines**: different DSPs for the same job, each with its own panel.
The compressor module, for instance, can run as Tracktion's compressor, Surge, Vari-Mu and more.
A card with engines shows an engine dropdown; switching keeps the knob values of each engine
separately.

```text
node engine vox-comp vari-mu
node engine vox-comp        # lists the engines
```

## Alternatives

An **alternative** is a named set of a node's settings. Badges on the card list them; click one
to play the node with it. The `+` badge creates a new alternative as a copy of the current one.

| Command | What it does |
|---|---|
| `node alternative create <node> [name]` | Add an empty alternative and switch to it. |
| `node alternative copy <node> [name]` | Add a copy of the current alternative and switch to it. |
| `node alternative select <node> [name]` | Switch to another alternative. |

## Freezing

`node freeze <node>` renders the node and everything upstream of it into one file, which then
plays in their place. A frozen node shows a snowflake; nodes inside the render are not running.
Unfreeze from the right-click menu.

k7 can also freeze **automatically**: an external plugin and what feeds it play as a render, so
an engine that lacks the plugin can still play the song. Touching a control on such a node thaws
it and the edit plays live.

## The plugin's own window

An external plugin with its own editor shows a button to **open the native plugin UI** on the
engine's machine. The command is `node external-ui <node>`.

## MIDI control

To play a parameter from a hardware controller:

1. Run `ui midi learn` (or use the control's right-click menu) and move the control on your
   controller.
2. Or bind it directly: `module cc synth Cutoff 1 74` binds CC 74 on channel 1. Use `none` to
   unbind.

Bindings are kept in the module folder's `controller.k7x`, so every node of that module answers
the same CC.

## Automation

Right-click a control and choose to automate it, or run `ui automate`, to open the curve editor
on that parameter. A control driven by a curve glows, and its knob shows how far the curve moves
it. See the automation section of the arranging guide for curves themselves.

## Racks and pads

A rack module (a drum kit) draws its sounds as **pads**. Click a pad to audition it. Click an
empty pad of the octave grid to add a sound on that note.

| Command | What it does |
|---|---|
| `node tap add <node> [symbol]` | Add a pad on the note after the highest. |
| `node tap at <node> <note> [symbol]` | Add a pad on a given note. |
| `node tap insert <node> <before\|after> <tap> [symbol]` | Add a pad on the nearest free note beside another. |
| `node tap note <node> <symbol> <note>` | Change the note a pad answers to. |
| `node tap sample <node> <symbol> <sample>` | Change the library sample a pad plays, or `none`. |
| `node tap rename <node> <symbol> <name>` | Rename a pad. |
| `node tap mute <node> <symbol> [on\|off]` | Silence a pad, or bring it back. |
| `node tap remove <node> <symbol>` | Remove a pad. |
| `node tap out <node> <symbol> <subchain>` | Send one pad to a subchain of its own, on its own output. `none` brings it back. |
| `node tap chain add <node> <symbol> <module>` | Add an effect to a pad's own chain. |
| `node tap chain remove <node> <symbol> <id>` | Remove an effect from a pad's chain. |
| `node tap chain move <node> <symbol> <id> <up\|down>` | Reorder a pad's chain. |

`ui tap chain` opens a popin on one pad's chain, where its effects are drawn as cards and edited
as on the graph.

## Recorders

A recorder node draws record, clear and save buttons over its waveform. Saving sends the take to
the media library's recordings (`node record save`).
