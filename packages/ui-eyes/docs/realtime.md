# realtime.ts — drawing the viewport live

## One `<video>` per LAYER, not per clip

A layer shows one clip at a time by construction, so per-clip elements would mean N
decoders for a lane that displays one picture. A cut swaps the element's `src`, which
costs a visible hitch — accepted for now; a later pass can preload the next clip in a
second element and swap at the boundary.

The element is muted (the file's audio is dropped by design, and muted is also what lets
it autoplay), parked 1px and invisible but NOT `display:none` — a `display:none` element
is allowed to skip decoding.

## Two-speed drift correction

The engine and each `<video>` keep independent clocks, so they drift continuously.
`step()` corrects with two mechanisms:

- **a small drift** is nudged out via `playbackRate` — invisible, but slow to converge,
  and only while playing;
- **a large jump** is hard-seeked — correct and instant, but it flushes the decoder and
  shows a hitch.

That asymmetry is the whole design: the cheap correction handles the common case
silently, and the expensive one is reserved for when the picture is already wrong enough
to be worth a visible reset.

This is also why realtime can be approximate where `export.ts` is not: a `<video>` seeks
to the nearest decodable frame, while the exporter pulls the frame whose presentation
interval contains the requested second, exactly.
