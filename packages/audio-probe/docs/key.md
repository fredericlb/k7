# `key.ts` — the key of a record, from decoded audio

`src/key.ts` is the **reference** detector: the engine's C++ analysis pass mirrors it, and the
tests here are what says whether either is right. The plan, the measurements and what is still
unknown live in the root's [key-detection-plan.md](../../../docs/key-detection-plan.md).

## Three steps, and only the middle one has an opinion

| step | what it is |
|---|---|
| samples → **chromagram** (12 pitch classes) | arithmetic, no taste |
| chromagram → **key**, by correlating against a profile | the profile IS the taste |
| key → **Camelot** | a lookup, for the wheel a DJ actually reads |

Keeping the taste in one step is what lets a profile be swapped and measured without touching the
arithmetic on either side of it.

## Goertzel rather than an FFT

A chromagram needs about sixty known frequencies, not a whole spectrum. One resonator per semitone
is a dozen lines, against an FFT plus windowing plus bin-to-pitch mapping. And the engine's pass is
a per-sample loop with no frame buffer, so this shape is also the one that ports into it.

## The frame is a DURATION, and the band starts at C3

A frame is fixed in **seconds** (`FRAME_SECONDS`, about 0.19 s), never in samples. A fixed
4096-sample frame resolves 5.4 Hz at 22 kHz and 11.7 Hz at 48 kHz, so the same code would silently
stop resolving semitones at the rate the engine actually runs at; fixing the duration fixes the
resolution, whatever the file's rate. It is then rounded up to a power of two, so an FFT port drops
straight in.

The chromagram listens from **C3 to C7**, and the bottom is a resolution limit rather than a taste:
a frame this long resolves about 5.4 Hz, the semitone step at C3 is 7.8 Hz, but only 3.9 Hz at C2,
so the bottom octave would smear each note across its neighbours and vote for the wrong pitch class.
Above C7 there is little but cymbals, which are noise and belong to no class at all.

Each frame is normalised **before** summing, so a loud chorus does not outvote a quiet verse: the
key is a property of the harmony, not of the mastering.

## The answer carries its margin

`keyOf` returns the best of the twenty-four keys **and how far ahead of the second best it
finished**. Key detection is wrong often enough that a bare answer would lie with a straight face; a
margin near zero is the detector saying it could not tell, and the desk can draw that as a doubt.

Measured: a minor key with no dominant comes back as its **relative major**, and the margin does
not separate that case from a correct one — both sit near 0.18. It says "one of these two
relatives", not which.
