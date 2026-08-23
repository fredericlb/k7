# `trimGate.ts` — where a take starts and stops SOUNDING

A recorded take begins with the tail of a count-in and the player settling, and ends with a room
and a hand leaving a string. `event trim` cuts both by asking where the envelope crosses a gate,
and `trimWindow` is the whole of that decision — pure, and nothing else.

## Bucket-accurate, and one bucket of margin

The answer is bucket-accurate and no finer, which is the honest resolution: the envelope IS
buckets, and pretending to a sample would be inventing precision the picture never had. A bucket
the interval only partly covers still counts, for the same reason.

The window is widened by one bucket at each end. A gate is a decision about where sound BEGINS,
and clipping the attack that crossed it would be audible where a few silent milliseconds are not.

## `within` is a cage, not a hint

`within` is the interval the clip already PLAYS — its current `from`/`to` — and the gate looks
only inside it: a re-trim refines the window and never reaches back into material an earlier trim
removed. The answer is clamped to it, the widening included, so a sound in the interval's first
bucket cannot push the result before the clip's own `from`. Omitted, the whole file is the
interval, which is what a first trim is.

## Null rather than a trim to nothing

Nothing in the interval above the gate answers null. A take entirely below the gate is either
silence or a gate set too high, and both are things to SAY rather than to apply — applying them
would leave a clip of zero length that plays nothing. A single bucket over the gate still has to
come back as a window and not a point.

## The floor, and why it is duplicated

`ampToDb` puts a zero bucket at −100 dB rather than at −Infinity, so comparisons are TOTAL:
`-Infinity > gate` is false, but so is `NaN`, and one of those is a bug waiting to happen.

That −100 is the same floor `peakPass.ts` declares as `PEAK_FLOOR_DB`, and it is deliberately not
imported from there: this file is browser-safe and st0's clip panel imports it, while `peakPass`
reaches for `node:child_process`. Sharing the constant would drag a process spawner into the
browser to save one number. The duplication is structural — see `docs/inventaire.md`.

The default gate is −40 dBFS: below a room's noise floor on any usable take, above true digital
silence, so a take recorded with the preamp up does not trim to nothing.
