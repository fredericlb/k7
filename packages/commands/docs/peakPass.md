# The measuring pass

A **cold** module of the measuring shape — the normaliser is the one — needs a number before it can
run: the gain depends on the loudest sample, and the loudest sample may be the last. `Peak` is an
*input* to its graph, and this is what fills it in.

Until this existed, nothing did. `Peak` stayed at its default of 0 dBFS, so `Target − Peak` was just
`Target`: a chain named `normalize` attenuated by 1 dB and called it a day. The default is 0 rather
than something more useful precisely because the un-measured state has to be harmless — wrong in the
attenuating direction, never the boosting one.

## Where it runs

Inside `processWithChain`'s per-source loop, immediately before each render — which is what
"offline, on a file, immediately before the render" meant. The peak is a fact about **one file**, and
`track process` renders one resolved chain over every file a lane's clips play.

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
that is plainly audible. Normalising that would have asked for +99 dB of gain, and the only thing
standing between that and a full-scale roar is the clamp the module carries for exactly this class
of accident.

The envelope is also written at `%.4f`, which is fine for drawing and not for a gain.

So the measurement is its own CLI mode, `--peak`, streaming the file in blocks and taking
`getMagnitude` across **all** channels. The engine owns it for the reason it owns every decode: it
owns the formats.

## The 3 dB the bounce used to lose

Writing this pass is what found it, because a normalisation is the first thing that asks a render
for an *exact* level. With `Target` set equal to the measured `Peak` — a gain of exactly 0 dB — a
−12 dBFS file came back at −15. So a normalise to −1 landed at −4, from every starting level.

**Tracktion's master fader defaults to −3 dB**, and nothing in this engine ever moved it. Every
mixdown it had ever written was 3 dB below the material that made it, on a fader no surface draws.
`EditBuilder`'s `populateEdit` sets it to unity, which puts playback, `--render` and a freeze on the
same level — a bounce that came back at one level and played at another would be audible the moment
you froze a track.

It took two wrong guesses to find, and both were instructive:

- **The track fader.** `applyTrackParams` says the track's own fader is left at unity, so a pan law
  there looked like the culprit. Setting it to linear changed nothing — because a stem render
  (`useMaster=false`) was *already* measuring exactly unity, which was the fact that named the master.
- **The master's pan law.** A sine law is 0.707 a side at centre, which is exactly 3 dB, so it fit
  perfectly. The plugin was asked instead of assumed, and answered `panLaw=0, vol=-3, pan=0`.

A third trap sat underneath both: **the builds were failing silently.** Two `cl.exe` processes
writing one PDB (`error C1041`) failed `studio_engine.lib` while the link happily reused stale
objects, so the .exe kept its timestamp updated and its behaviour frozen. Every measurement in that
window described code that was never compiled. What caught it was checking the binary for a string
that should have been in it, not the build log.

Compensating in the normaliser would have been wrong twice over — a render-path constant baked into
a module's gain, and every other chain still 3 dB down. The measurement is the same either way; only
this makes it land.
