# The measuring pass

A **cold** module of the measuring shape — the normaliser is the one — needs a number before it can
run: the gain depends on the loudest sample, and the loudest sample may be the last. `Peak` is an
*input* to its graph, and this is what fills it in.

`Peak` defaults to 0 dBFS, so a chain the pass never touched computes `Target − Peak` as just
`Target`: a chain named `normalize` attenuates by 1 dB and calls it a day. The default is 0 rather
than something more useful precisely because the un-measured state has to be harmless — wrong in the
attenuating direction, never the boosting one.

## Where it runs

Inside `processWithChain`'s per-source loop, immediately before each render: offline, on a file. The
peak is a fact about **one file**, and `track process` renders one resolved chain over every file a
lane's clips play.

So `withMeasuredPeak` returns a copy and never writes back into the chain. The bug it exists to
prevent is quiet: the second file would be rendered with the first file's gain, only the files after
the first would be wrong, and nothing about the result would say so.

`needsPeak` is asked once, before the loop. A chain with no measuring step decodes nothing — most
bounces are not normalisations.

## Why not the waveform sidecar

The `{file}.cache` envelope already holds a `peak[]` array, and taking `max()` of it looks like the
whole job for free. It is wrong, and quietly:

| file | `--peak` (true) | envelope (mono sum) | error |
|---|---|---|---|
| mono, peak 0.5 | −6.02 dB | −6.02 dB | 0.00 |
| stereo, peak on ONE channel | −6.02 dB | −12.04 dB | **−6.02** |
| stereo, channels in anti-phase | −6.02 dB | −100.00 dB | **−93.98** |

`Waveform.cpp` averages the channels into one signal before taking its per-bucket maximum — it is
drawing a waveform, and one line is what a waveform is. A peak living on one side reads 6 dB low;
two channels in anti-phase sum to nothing at all, and the envelope reports **silence** for a file
that is plainly audible. Normalising that asks for +99 dB of gain, and the only thing standing
between that and a full-scale roar is the clamp the module carries for exactly this class of
accident.

The envelope is also written at `%.4f`, which is fine for drawing and not for a gain.

So the measurement is its own CLI mode, `--peak`, streaming the file in blocks and taking
`getMagnitude` across **all** channels. The engine owns it for the reason it owns every decode: it
owns the formats.

## The 3 dB a bounce must not lose

A normalisation is the first thing that asks a render for an *exact* level: with `Target` set equal
to the measured `Peak` — a gain of exactly 0 dB — a −12 dBFS file has to come back at −12. Any
constant offset in the render path lands in the gain instead, and a normalise to −1 would land at
−4 from every starting level.

**Tracktion's master fader defaults to −3 dB**, on a fader no surface draws, so a mixdown taken as
it comes is 3 dB below the material that made it. `EditBuilder`'s `populateEdit` sets it to unity,
which puts playback, `--render` and a freeze on the same level — a bounce that came back at one
level and played at another would be audible the moment you froze a track.

Two things that are *not* the offset, and both look like it:

- **The track fader** is left at unity by `applyTrackParams`, so a pan law there is not it — a stem
  render (`useMaster=false`) measures exactly unity, which is what names the master.
- **The master's pan law** is `panLaw=0`. A sine law would be 0.707 a side at centre, which is
  exactly 3 dB and fits perfectly; ask the plugin rather than assume.

Compensating in the normaliser would be wrong twice over — a render-path constant baked into a
module's gain, and every other chain still 3 dB down. The measurement is the same either way; only
the unity fader makes it land.
