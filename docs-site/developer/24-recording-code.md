# MIDI, recording and takes

Recording is split by where the input physically is: **audio** is captured by the engine on its
machine, **MIDI** by the browser where the keyboard is. The two meet only at the transport — the
same Record and Play — and at the takes view.

## Arming: two kinds of state, neither a file

| Arm | Held by | Set by |
|---|---|---|
| Audio | The engine's session; reported back in every state frame (`useEngineState(s => s.armed)`) | `transport arm <track>` — a verb that writes nothing, so the CLI has it too |
| MIDI | The browser: `midiArmed` in `App.tsx`, one lane at a time | The lane's arm button, through `onTrackToggle` in `apps/k7/frontend/src/hooks/useTrackControls.ts`; the local line `rec <track>` and the `r` key call the same function |

`onTrackToggle` decides which: a lane that holds a sequence or is fed by a midi-in node
(`midiSeqRef`, `midiLanesRef`, found by `apps/k7/frontend/src/midiIn.ts`) arms in the browser; any
other lane sends `transport arm`. The arm button reads both (`armed.includes(id) || midiArmed === id`).
`rec <track>` is a local line in `App.tsx` that calls `onTrackToggle(id, "arm")`, so it is the A
button whatever the lane holds, and the `r` key is bound to `rec {caret_track}`
(`apps/k7/frontend/src/keys.ts`). Typed `transport arm` stays the engine's verb: on a MIDI lane it
reaches the engine, not the browser.

Record enable is a third, separate state: `transport record` / the header button call
`engine.setRecordEnabled`. With Record on and nothing armed (audio, MIDI or picture), Play is refused
with `NO_ARM_HINT`.

The audio arm's checks are in the `transport arm` handler (a group, no input, a single-file song) and
in the engine (no interface channel, two armed lanes sharing an input). The file service waits for
the engine's answer (`awaitArm` in `packages/file-service/src/engineArm.ts`, 2 s) so a refusal
reaches the command bar instead of being lost, after waiting up to 5 s for the session's link to
the engine to open: a page coming back to the front re-dials it.

## Inputs

`track input <track> audio|midi` (`packages/commands/src/verbs/trackInput.ts`) inserts an input
node ahead of the lane — an `@meta/IN` with `monitor: "auto"`, or an `@meta/MIDI`. Its settings are
**intrinsics**, a module's own fields rather than plugin parameters, written with `node param`:
`@channel`, `@monitor`, `@gain`, and `@device` for MIDI. `apps/k7/frontend/src/laneInput.ts` decides
whether a lane already has an input by walking upstream, which is what greys out the per-track
buttons.

## MIDI capture

`apps/k7/frontend/src/webmidi.ts` owns Web MIDI access. Access is requested on a user gesture (the
first MIDI arm, Record with a MIDI lane armed), since browsers reject it otherwise. The device is the
`@device` label of the midi-in node wired to the armed lane: `""` means any, `null` (no midi-in) means
nothing is captured. `matchMidiDevice` matches exactly, then case-insensitively, then by containment.

Every channel message from a matched device goes to the engine at once (`engine.liveMidi`), which is
the thru; `apps/k7/frontend/src/midiActivity.ts` lights the card on any device.

`apps/k7/frontend/src/hooks/useMidiRecording.ts` runs the capture while Record (or the takes view's
browser record) is on, the transport plays and a lane is armed. Timing is raw song beats,
interpolated between engine frames with `performance.now()`; nothing is quantized on purpose. On
stop, `inTake` drops count-in notes (a note up to a quarter beat early is pulled onto the downbeat),
closes held keys at the stop, and the take is committed as **one** command:

```text
sequence record <lane> [{"t":16.02,"d":0.48,"k":60,"v":0.79}, …]     # song beats
```

`packages/commands/src/verbs/sequenceRecord.ts` writes a new `sequences/<lane>-rec-<n>.k7x` whose
window runs from the bar of the first note to the bar after the last, places it on the lane at that
bar in the same run (one undo), and removes the file if the placement fails. Every take is a new
sequence; `sequence note add` (append to an existing one) is used by paste, not by recording.

`apps/k7/frontend/src/components/MidiTakeRoll.tsx` draws the live roll; `TimelineTab` draws the growing take on its lane
from the `midiTake` prop, since nothing on disk names it yet.

## MIDI learn and controllers

`ui midi learn <module> <param>` arms the browser to swallow the next CC
(`App.tsx` `armMidiLearn`, `apps/k7/frontend/src/midiControl.ts`), then runs
`module cc <module> <param> <ch> <cc>`. A pending learn is cancelled by the next command:
`runCommand` calls `cancelLearn` before it dispatches anything, and `cancelLearn` hands `null` to
the learn's callback, which puts "MIDI learn cancelled" on the status line. `Esc` is the first rung
of its ladder while a learn waits (`midi_learning` → `ui midi learn cancel`), so it cancels the
learn and closes nothing behind it. The map is written to `controller.k7x` in the **module's**
folder (`packages/song/src/controllerBind.ts`), so every node of that module in every project plays by
it. `apps/k7/frontend/src/hooks/useMidiControl.ts` applies incoming CCs scaled into the widget's range and sends the value
back to an output port of the same name when there is one.

## Audio takes

The engine writes the take into the project's `clips/` and reports
`{type:"recorded", track, file, start, length}`. The file service files it with
`packages/take-render/src/recordTake.ts`: renamed to `<track>_<bar.beat>_<stamp>.wav` (`fileStamp`),
declared in `clips/<id>.k7x`, then either placed on the lane (`addTakeToTrack`) or added as a take of
an event (`addTakeToEvent`) when the session is take-armed for that track. The count-in comes from
`count_in` in the song's settings (default one bar); the frontend uses it only to skip the pre-roll
when drawing the growing block (`apps/k7/frontend/src/takeCounter.ts`, `recordingFrom`).

## Takes and comps

An event's takes and comp are placement fields (`takes`, `comp`, `crossfades` in
`packages/song-schema/src/yaml/placementSchema.ts`); `comp` spans are **song positions**, unlike the
window's seconds. The YAML half is `packages/song-schema/src/yaml/takeFile.ts`, the disk half
`packages/song-edit/src/takeEdit.ts`, the verbs `packages/commands/src/verbs/eventTakes.ts`:

| Verb | Writes |
|---|---|
| `event comp <t> <at> <take> <from> <to>` | One span of the comp. |
| `event comp fade <t> <at> <seam> <len>` | A crossfade centred on a seam; `0` removes it. |
| `event take remove <t> <at> <ref>` | The take and every span it played; the file stays. |
| `event take midi <t> <at> <json>` | A MIDI pass filed as a take (its own sequence). |
| `event take arm <t> <at> <from> [to]` / `disarm` | Session state in the file service (`packages/file-service/src/takeArm.ts`), never a file. While armed, the engine gets the lane with the punch cut out, so the take is heard only there. |

The compile turns a comped event into pieces (`compPieces` in `packages/song-schema/src/takes.ts`);
the timeline draws them as one block with the layers icon, and the waveform panel's `CompStrip.tsx`
lets a piece's edges be dragged into `event comp` lines.

`apps/k7/frontend/src/components/TakesView.tsx` and `TakeRow.tsx` draw the takes mode; `apps/k7/frontend/src/takes.ts` is
its pure half — the heard spans, span snapping to a quarter beat, the lines for comp, arm and seam
fades. `apps/k7/frontend/src/hooks/useTakeRecording.ts` is the record button: it arms what is needed (MIDI or audio),
turns on Record, seeks to the punch and plays, then puts everything back and disarms after the take
has landed.

## The metronome

`apps/k7/frontend/src/components/MetronomeButton.tsx`: click runs `transport metronome`, right-click opens a level slider
that commits `transport metronome volume <0.2..1>`. Both are `settings.k7x` fields read by the engine
off the compiled document. The floor of 0.2 is the engine library's own clamp; silence is the switch.

## The transport panic

Every stop goes through one callback in `apps/k7/frontend/src/hooks/useEngineLink.ts`, and
`apps/k7/frontend/src/transportPanic.ts` turns a second stop within 800 ms into `panic` — at that
seam rather than on the button, so the key, the button and the command bar behave alike.

## See also

- [The edit path](./21-edit-path.md)
- [Testing the arrangement code](./28-arrangement-tests.md)
