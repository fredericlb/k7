# How m9 is wired

The plan's last leaf, and the one it called the real test: *"m9 (second consommateur
des étapes 5 et 6 : c'est là qu'on découvre si les coutures étaient réelles)"*.

v1 is deliberately small — pick a morceau, the engine plays it — so what it actually tests
is étape 6 (the médiathèque as a catalogue for a *second* app) and étape 7 (listening to
what the engine puts out). The chains view, which is étape 5's seam, is not here yet.

## Three endpoints, and only one of them is hosted

**The moteur opens file paths.** It cannot fetch a URL. So the thing m9 plays from is
not the hosted médiathèque at `media.studio.frediver.se` — it is the *cache* of it on a
disk, and only that machine's own file service knows where that is. That has not changed and
will not.

What changed is that m9 gained a small backend of its own:

| what | where | how it is found |
|---|---|---|
| who you are, which engines exist, which one you DJ from | m9's backend, same-origin `/api` | the page it served |
| the cached catalogue + the cache's root | the CHOSEN engine's file service | `fileBase` from its probe reply |
| playback | the CHOSEN engine | `wsUrl` from its probe reply |

The backend holds no media and no files. It knows **who you are** and **which engines
exist**, never what is on any engine's disk — pistes' backend, verbatim, for the same reason.

Two text boxes disappeared with it. The file service's address used to default to
`http://127.0.0.1:8770` and be editable; the DJ used to type their own identity into a
second box, which the file service then trusted and nothing checked. Both are now derived:
the file service sits on the chosen engine's host — only the engine knows which host that
is — and the identity is the OIDC session's.

### Why the engine is chosen and no longer probed

v1 probed loopback, on the argument that a deck plays out of the interface in front of you.
That is true of the *interface*, not of the *browser*: a laptop can drive the rig across the
room. Now the account picks a machine, m9's own registry lists the candidates, and the
choice is remembered — see `packages/user-prefs/docs/store.md` and
`packages/engine-registry/docs/shared.md`.

The picker is a gate rather than a panel, unlike the médiathèque's: an editor without an
engine still edits text, but a deck without one has nothing to do at all.

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

* **No chains view.** Étape 5's seam is untested by this. It is the reason m9 exists
  in the plan, and it needs a graph to draw — which needs a compiled project, which v1 does
  not have.
* **One deck.** `DECK` is a single chain name. A second is a second track and a crossfade,
  and neither is in the document yet.
* **No mixing, no cue, no tempo.** v1 is "choose a song and diffuse it", literally.
* **The file service still trusts the header.** m9 now proves who you are to its OWN
  backend, and sends that identity as `x-studio-user` — but the file service verifies no
  session, so its CORS allowlist is still the real boundary, as it is for pistes. What the
  login bought is that the identity is no longer typed by hand; it is not yet a gate on the
  machine's disk.
* **Never run end to end.** The 8 tests cover the two things that decide — the path join and
  the document — and the app typechecks and builds. Whether the file service answers
  `/mediatek/list` to this origin, and whether the engine plays what it is sent, has not
  been exercised.
