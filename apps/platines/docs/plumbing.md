# How platines is wired

The plan's last leaf, and the one it called the real test: *"platines (second consommateur
des étapes 5 et 6 : c'est là qu'on découvre si les coutures étaient réelles)"*.

v1 is deliberately small — pick a morceau, the engine plays it — so what it actually tests
is étape 6 (the médiathèque as a catalogue for a *second* app) and étape 7 (listening to
what the engine puts out). The chains view, which is étape 5's seam, is not here yet.

## It talks to the MACHINE, not to a server

platines has no backend, and the reason is the shape of the problem rather than
minimalism: **the moteur opens file paths.** It cannot fetch a URL. So the thing platines
needs is not the hosted médiathèque at `media.studio.frediver.se` — it is the *cache* of it
on this disk, and only the machine's own file service knows where that is.

Two runtime endpoints, both cross-origin, both on this machine:

| what | where | how it is found |
|---|---|---|
| the cached catalogue + the cache's root | file service, `:8770` | a constant, editable in the panel |
| playback | the engine, `:8765` | `probeLocalEngine()` |

The engine is probed rather than configured, exactly like mediatek's module preview: a deck
plays out of the interface in front of you, so "which of my engines" has no question to
answer. The file service is a setting because its port is the one thing that moves (a second
service, a remote workspace) and there is no probe for it.

## The gap that had to be filled: a morceau is a folder

`MediatekEntry.path` is the **folder** — a morceau is a folder with a `morceau.yaml` beside
its audio — so an entry alone was not enough to open anything. The scan already found the
master file to report its size; it just never said its name.

So `scan.ts` now reports `meta.master`, and `playablePath()` joins
`root + entry.path + meta.master`. Its **absence** is a real state, not a malformed entry: a
folder catalogued with no audio is a mirror that failed halfway, or one made by hand. The
list disables Play and says which of the two problems it is — a dead button explains nothing.

The join keeps the root's own separator instead of normalising: the service reports a native
root (`C:\…` or `/home/…`) while entry paths are POSIX, the engine takes either, and picking
one shape would be this app deciding something it does not own.

## Why not `MoteurPlayer`

`@studio/player-web/moteur` builds a one-track document from a path in its first ten lines,
which is the whole of `deck.ts`. It was tempting.

It implements **obscura's** `Player`: `preloadSong`, `playMulti`, `playDual`,
`playReversed`, nine effect sliders. Nine tenths of that is a blind test's vocabulary, and a
deck routed through it would inherit semantics it has to explain away — what `preloadSong`
means when there is no round, why `playReversed` rejects.

What *is* shared is the layer underneath: the document constructors in
`@studio/engine-protocol/build`. That is where the duplication was worth removing, and it
was removed in étape 1. Two callers building different documents out of the same
constructors is the seam working, not a missed abstraction.

## Listening is opt-in, and off by default

The sound already comes out of this machine's interface — that is the point of playing on
the engine. The étape-7 broadcast is a checkbox because on a laptop with no monitors it is
the only way to hear anything, and because doubling the output is the wrong default.

It builds its `AudioContext` at the rate the **first frame's header** reports. The sink does
not resample, so a mismatched context is a pitch shift: inaudible as a *fault*, obvious as
"the engine sounds wrong". Turning the toggle off tears the pipeline down rather than muting
a gain, because an idle `AudioContext` and a live one are not the same thing on a machine
that is also playing audio for real.

The panel shows buffer depth and underruns, which are the numbers étape 7 exists to expose.
The default cushion is 150 ms — measured, see `packages/engine-browser/docs/streaming.md`.

## Ordering that matters

`loadAndPlay` sends the **document first, then the transport verb**. Reversed, the play
would start whatever the engine still had loaded, which on a deck is the previous song.

`isPlaying` comes from the engine's state frame, never from a flag set hopefully when a play
was sent: a file that failed to load leaves the transport stopped, and the deck has to show
that rather than a lit button.

## Not done

* **No chains view.** Étape 5's seam is untested by this. It is the reason platines exists
  in the plan, and it needs a graph to draw — which needs a compiled project, which v1 does
  not have.
* **One deck.** `DECK` is a single chain name. A second is a second track and a crossfade,
  and neither is in the document yet.
* **No mixing, no cue, no tempo.** v1 is "choose a song and diffuse it", literally.
* **No auth beyond the user header.** The file service's CORS allowlist is the real
  boundary, as it is for lanes; platines sends `x-lanes-user` and nothing else, because the
  médiathèque routes are mounted before `resolveWorkspace` and need no workspace.
* **Never run end to end.** The 8 tests cover the two things that decide — the path join and
  the document — and the app typechecks and builds. Whether the file service answers
  `/mediatek/list` to this origin, and whether the engine plays what it is sent, has not
  been exercised.
