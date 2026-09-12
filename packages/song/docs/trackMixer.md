# A track's strip

Every audio lane has a **strip of its own**, last in its run, just before the mixer's sum: a NODE
on the library's `@st0/audio/utility/mixer` — `SHARED_STRIP`, the one every mixer node in every
project is a use of. That node is the lane's level: `Volume` in dB, `Pan` from −1 to +1, and three
bands, over the engine's own internal plugin (`MixerPlugin.cpp`), so nothing has to be installed
for a song to have faders.

**A node, and never a project-owned copy of the module.** A copy compiles to exactly the same
audio and draws **a card with no controls on it**: a card draws the `ui.yaml` beside the module it
resolves to, and the library's `mixer/` is what carries one — a fader and four knobs. The same
argument, at more length and with the way it was found, is in
[liveProject.md](liveProject.md). It is also the general rule: a project owns a module when it
CHANGES one, and a strip changes nothing.

```yaml
# graph.yaml
modules:
  pad:      [ synth-pad ]
  synth-pad: [ mix-pad ]     # …and the strip goes here, at the end
  mix-pad:  [ MIX ]
  MIX:      [ OUT ]
```

## Why a module and not a field

A lane could have carried `volume:` and `pan:` in `nodes/<id>.yaml`, and it would have been less
to write. It would also have been a second place for a level to live: the strip already exists as
a plugin the engine hosts, with automation, a panel and a MIDI map like every other module. Two
answers to "how loud is this lane" is the one thing the graph model refuses everywhere else.

So the fader on a lane's timeline gutter, the one on its card in the chains graph, and the whole
Mixer view are **three drawings of this one node**, and `node param mix-pad Volume -6` is what
each of them sends. A hand-rolled strip per lane would drift from the panel the library module's
`ui.yaml` declares — the module grows a knob and the strip never shows it.

## It goes LAST

A level belongs after whatever makes the sound, and `trackMixer` reads the **last** mixer in a
run — so a strip spliced anywhere else would be a level the reader cannot find and, on a run with
two of them, the wrong one.

For a lane already wired, that means splicing into the one arrow between its run's last module and
`MIX`. For an ORPHAN lane — one no chain mentions, which is what `track new` used to leave behind
— the lane and its strip arrive together, `lane: [ mix-lane ]` and `mix-lane: [ MIX ]`.

## What it refuses

A run that ends anywhere but the sum: a real bus (two lanes meeting), a send, a split. That is
somebody's own arrangement, and a strip spliced into it would rewrite what it means. The lane is
named and left alone rather than guessed at.

## Two ways to BE one

`hasTrackMixer` asks both, and needs to. A node extending `SHARED_STRIP` is one by construction —
readable off the file, with no library and no plugin scan in the picture. Anything RESOLVING to
the `Mixer` plugin is one too: that is every strip written before this, and every hand-made one
that names the plugin directly.

Neither question answers alone. The ref misses a project that names the plugin itself; the
resolved plugin misses a machine whose library is not mounted or whose engine has scanned
nothing — and a `false` there is not a missing fader on screen but a SECOND strip spliced in by
the next `track new`.

## Where it comes from

- **`track new`** writes it with the lane. A project with no `graph.yaml` has nowhere to wire one:
  the lane is still made, and the missing strip is *said* rather than thrown.
- **`scripts/migrateTrackMixer.ts`** gives one to every lane that predates the rule. Dry by
  default, idempotent, and through the yaml Document API, so `graph.yaml` keeps its comments.
- **The importer** writes one per lane it emits (`packages/translator/docs/import.md`), as a NODE
  on the library's `@st0/audio/utility/mixer` — it does not go through this file, a foreign
  project's chain being built from scratch with nothing to splice into.

```
npx tsx packages/song/scripts/migrateTrackMixer.ts <projet.st0> [more…] [--write]
```

The decision and the writes are split — `planTrackMixer` then `applyTrackMixer` — so the dry run
reports what it would actually do instead of promising something it has not worked out.
