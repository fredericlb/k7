# LUTs — a `.cube` file as a 3D texture

What a look is for is [../../song-video/docs/effects.md](../../song-video/docs/effects.md). This
page covers how the renderer gets one onto the GPU: `cube.ts` parses, `luts.ts` uploads, and a
pass reads it as `uLut` beside `uLutSize`.

## Once per file, however many passes read it

`Luts` keys a texture by the file's URL, so ten shots graded with one look upload it once. A new
scene keeps the textures it still names and frees the rest, which makes an edit elsewhere in the
song cost no re-upload.

## Loading is asynchronous, drawing is not

A LUT is a fetch away, and a frame cannot wait for one. A pass whose LUT has not arrived is handed
`uLutSize` 0, which a LUT shader reads as "let the picture through" (`@st0/shaders/look` does).
So the preview shows the ungraded picture for the moment the file takes, instead of a black frame
or a stall. An EXPORT awaits `Compositor.ready()` before frame 0, since a render whose first frames
were ungraded is a wrong render. A LUT that cannot be read is said once on the console, and its
pass draws its picture through.

## RGBA16F, linear, clamped

The entries are uploaded as `RGBA16F` from float data. A half-float 3D texture is filterable in
WebGL2 with no extension, and a 32-bit float one needs `OES_texture_float_linear`, which not every
GPU has. Linear filtering is what turns a 33³ table into a continuous grade, and clamping keeps
an out-of-range lookup on the table's edge. Red varies fastest, in the file and in `texImage3D`
alike, so the entries go up in the order they are read.

A `.cube` with a `DOMAIN_MIN`/`DOMAIN_MAX` other than 0..1 is folded back onto it on parse, that
being the range a texture holds. A 1D LUT, a missing size and a wrong entry count are each refused
by name, since a LUT read wrongly still produces a picture, and a wrong picture is harder to catch
than an error.

## Checked in a browser

Node has no WebGL, so `cube.test.ts` pins the parse and nothing here can draw. The pipeline was
checked in headless Chrome over SwiftShader, with a solid colour through the library's `look`:
an identity LUT returns it exactly, an inverting one returns 255 minus each channel, half strength
lands halfway, and a pass with no LUT yet returns the input. That check is worth repeating whenever
the upload changes.
