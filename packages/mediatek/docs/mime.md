# One MIME table, and why it lives here

`media.ts` holds `MIME_BY_EXT` and `mimeFor`. Nothing else in the repo decides what a
médiathèque file is served as.

## The failure that produced it

The library is served by **two HTTP shells** over one library:

| shell | serves |
|---|---|
| `apps/pl8/backend/src/routes/library.ts` | the hosted volume |
| `packages/file-service/src/routes/mediatek.ts` | this machine's cache |

Each had written its own table, and they drifted **in both directions** — neither was a
superset of the other:

* only the hosted one knew `.aiff`, `.aif`, `.opus`, `.mkv`, `.nam`
* only the cache one knew `txt`, `png`, `jpg`, `jpeg`, `webp`

So an AIFF or an amp model served from the cache, and a cover served from the hosted
volume, both went out as `application/octet-stream` — which a browser downloads instead of
playing or showing. Nothing failed loudly; a `<audio>` element simply did nothing.

They had also drifted in **shape**, which is the more interesting half: one keyed `".wav"`
and read it with `extname()`, the other keyed `"wav"` and read it with `split(".").pop()`.
Two tables that could not have been merged by copying either one into the other.

## The convention, and why

**Keys carry the dot, lowercase.** `.wav`, not `wav`.

* `extOf()` — already in `media.ts`, already shared with the browser — returns `".wav"`.
* `AUDIO_EXT` and `VIDEO_EXT`, in the same file, are dotted. A third convention inside one
  file is exactly how this drifted the first time.
* `node:path`'s `extname()` is dotted, so the hosted shell needs no adapter.
* The dot distinguishes "no extension" (`""`) from a key, and preserves `extOf`'s rule that
  a leading dot is not an extension — `.gitignore` is a whole name.

`mimeFor` reads the **last path segment's** extension. Both old versions were subtly worse:
the cache's `split(".").pop()` returned `"2/patch"` for `modules/v1.2/patch`, mis-keying any
path whose *directory* carries a dot.

`application/octet-stream` is the default and stays honest: the browser downloads the file
rather than being told something false about it.

## What stops it happening again

`media.test.ts` pins three things, and the middle one is the load-bearing one:

1. **Whole-table equality** — not a snapshot. Adding an entry is a one-line reviewable change
   to the test; deleting one fails with a readable diff.
2. **The shape lock** — every key matches `/^\.[a-z0-9]+$/` and round-trips through `extOf`.
   The original drift was a drift of shape, and no pair of tables in two shapes can satisfy
   this.
3. **Coverage of the scan** — every extension `AUDIO_EXT` or `VIDEO_EXT` claims has an entry,
   so a format that can be catalogued can always be served. `.avi` was added for this reason:
   the scan already listed it as video and neither shell could send it.

Each shell has one test asserting its 400 body equals the shared `FAMILY_ERROR`. A test that
mounted both routers and diffed them cannot exist — `@studio/file-service` is a bundled
program and `pl8-backend` does not depend on it — so the shared constant is the contract and
those two tests are its witnesses.

## What is deliberately NOT shared

The **routing**. The two shells keep their own routers and their own 404 semantics, because
they answer different questions: the hosted volume has nothing in front of it and
distinguishes "not a file" from "not found", while the cache's `present: false` is a normal
answer rather than an error. A router factory parameterised by three or four policies to
share three and a half handlers would be more machinery than the duplication it removed —
and it would put `express` inside a package three frontends import for `./types` and
`./media`.

What they share is the **vocabulary**: family names (`types.ts`), extensions and content
types (`media.ts`), and what a search query means including its limit (`catalogue.ts`).
