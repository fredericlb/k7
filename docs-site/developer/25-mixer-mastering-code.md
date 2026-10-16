# Mixer, meters and mastering

## A lane's level is a module

There is no mixer object in k7. Every lane's chain ends in a **Mixer** module — the built-in
`packages/song/meta/audio/mixer/module.yaml` (an internal plugin) with its panel in
`packages/song/meta/audio/mixer/ui.yaml`: Volume fader −60..+6 dB, Pan −1..1, High/Mid/Low −18..18
dB, and a `@highlight` button. `track new` writes the strip with the lane because a lane without one
has nowhere to put a level. Because the strip is a module, its values follow alternatives and presets
like any other module's, and the chains graph is what draws it.

**The mix panel.** `ui mixer` (`toggleMixer` in `App.tsx`) opens the `mix` bottom panel:
`apps/k7/frontend/src/components/GraphPanel.tsx` with `strips`, which asks the graph renderer to put every strip on one
rank and lay it out as a row. `apps/k7/frontend/src/mixerStrips.ts` picks the strips from the compiled
song — each track's mixer node in track order, a shared bus strip once. The controls themselves are
drawn by `packages/ui-chains-react/src/DomChains.tsx`, which is why a strip behaves exactly like any
module card: vertical drag (Shift for fine), live sends to the engine coalesced per animation frame,
and on release one `node param <strip> "Volume" <dB>` written by `setModuleParam`
(`packages/song-edit/src/projectEdit.ts`). Double-click opens a typed value.

**Mute, solo, highlight** are not strip parameters but project or graph state, so they are their own
verbs:

| Verb | Writes |
|---|---|
| `track mute` | The lane's bypass in the graph (`bypassed:`), since a lane is a module. |
| `track solo` | Membership of `soloed:` at the root of `project.yaml`; several at once, resolved by the engine. |
| `track highlight` | Membership of `highlighted:`; the compile (`packages/song/src/highlight.ts`) adds 10 dB to the last strip's output. |

`apps/k7/frontend/src/hooks/useTrackControls.ts` is the one implementation the timeline buttons, the graph's lane controls
and the `m`/`s` keys share: an optimistic flip, the command, then a reload scoped to the files it
wrote. On a shared snapshot (`local`) the override **is** the value and no command is sent.

**The console.** `project console <system|none>` (`packages/commands/src/verbs/console.ts`) writes
`project.console`; the compile (`packages/song/src/console.ts`) places the system's channel after
every strip and its buss first on the master — one setting, because the halves only work as a pair.

## The song's output and the master meter

The song's output level is `project.masterVolume`, −100..+12 dB, written by `project master` and by
`node param "OUT" Volume` (the same writer, `writeMasterVolume` in `packages/commands/src/commands.ts`).
Values outside the range are refused, not clamped. The engine applies it with a gain of its own rather
than the host library's master fader, whose curve saturates at +6.

`apps/k7/frontend/src/components/MasterMeter.tsx` draws the header meter: fill from `meterFill` (linear in dB from −60),
amber from −6 dB, a range input over it as the output fader (−60..+12 in 0.5 dB steps, committed on
release). The clip light and the held peak come from `packages/engine-browser/src/meter.ts`: the
latch survives the stop and clears on the rising edge of `playing`, so a pass's verdict is still
readable after it ends.

**Fix** is `project master fix [peak]`, a shell-local verb because the peak exists only in the
browser that watched the pass. `apps/k7/frontend/src/gainTrim.ts` computes the trim — never positive,
aiming the peak at −6 dB, clamped to the fader's range — and the shell writes the result with
`node param "OUT" Volume`. Only the output moves; the strips are untouched.

## The mastering surface

A project declares a `mastering` surface (`surfaces/<id>.yaml`, layout `split`), whose `mapping` names
which module parameter each of thirteen controls drives (schema:
`packages/song-schema/src/yaml/mixViewSchema.ts`, `surfaceSchema.ts`). `apps/k7/frontend/src/components/MasteringTab.tsx`
draws them as three appliances, with the control list in `apps/k7/frontend/src/mastering/controls.ts`
and the resolution in `apps/k7/frontend/src/mastering/bindings.ts`, which reuses `resolveMapping` from
`packages/ui-chains/src/bindings.ts` (shared with the DJ desk). A required control left unmapped is
reported on the surface rather than refusing the project.

A slider calls `setPluginParam` (a live send) on every step and writes `node param "<module>"
"<param>" <value>` once, when the gesture ends (pointer up, key up or blur), through `App`'s
`quietCommand` — the same write the chains graph commits for a knob. A dropdown writes on its pick.
The line is built by `masterParamLine` in `bindings.ts`, tested in `bindings.test.ts`; the rationale is
in `apps/k7/frontend/docs/mastering.md`.

## Known rough edges

- A few user-facing strings in `MasterMeter.tsx`, `MasteringTab.tsx` and `SharePanel.tsx` are French
  literals outside the message catalogue.

## See also

- [Rendering, export and bouncing](./26-render-process-code.md)
- The chains graph range of this guide, for `DomChains` and the module panels.
