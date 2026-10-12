# One MIME table, and why it lives here

`media.ts` holds `MIME_BY_EXT` and `mimeFor`. Nothing else in the repo decides what a
médiathèque file is served as.

## Why one table

The library is served by **two HTTP shells** over one library:

| shell | serves |
|---|---|
| `apps/st0/backend/src/media/routes/library.ts` | the hosted volume |
| `packages/file-service/src/routes/mediatek.ts` | this machine's cache |

A table per shell drifts **in both directions** — neither ends up a superset of the other —
and neither half of the drift fails loudly. An extension one shell knows and the other does
not goes out as `application/octet-stream`, which a browser downloads instead of playing or
showing: an `<audio>` element simply does nothing.

Two tables also drift in **shape**, which is the harder half: one keyed `".wav"` and read
with `extname()`, the other keyed `"wav"` and read with `split(".").pop()`, cannot be merged
by copying either one into the other.

## The convention, and why

**Keys carry the dot, lowercase.** `.wav`, not `wav`.

* `extOf()` — already in `media.ts`, already shared with the browser — returns `".wav"`.
* `AUDIO_EXT` and `VIDEO_EXT`, in the same file, are dotted. A third convention inside one
  file is exactly how a table drifts.
* `node:path`'s `extname()` is dotted, so the hosted shell needs no adapter.
* The dot distinguishes "no extension" (`""`) from a key, and preserves `extOf`'s rule that
  a leading dot is not an extension — `.gitignore` is a whole name.

`mimeFor` reads the **last path segment's** extension. A bare `split(".").pop()` returns
`"2/patch"` for `modules/v1.2/patch`, mis-keying any path whose *directory* carries a dot.

`application/octet-stream` is the default and stays honest: the browser downloads the file
rather than being told something false about it.

## What stops it drifting

`media.test.ts` pins three things, and the middle one is the load-bearing one:

1. **Whole-table equality** — not a snapshot. Adding an entry is a one-line reviewable change
   to the test; deleting one fails with a readable diff.
2. **The shape lock** — every key matches `/^\.[a-z0-9]+$/` and round-trips through `extOf`.
   Drift is first of all a drift of shape, and no pair of tables in two shapes can satisfy
   this.
3. **Coverage of the scan** — every extension `AUDIO_EXT` or `VIDEO_EXT` claims has an entry,
   so a format that can be catalogued can always be served. `.avi` is there for this reason:
   the scan lists it as video.

Each shell has one test asserting its 400 body equals the shared `FAMILY_ERROR`. A test
mounting both routers and diffing them cannot exist — `@studio/file-service` is a bundled
program and st0's backend does not depend on it — so the shared constant is the contract and
those two tests are its witnesses.

## What is deliberately NOT shared

The **routing**. The two shells keep their own routers and their own 404 semantics, because
they answer different questions: the hosted volume has nothing in front of it and
distinguishes "not a file" from "not found", while the cache's `present: false` is a normal
answer rather than an error. A router factory parameterised by three or four policies to
share three and a half handlers would be more machinery than the duplication it removes —
and it would put `express` inside a package three frontends import for `./types` and
`./media`.

What they share is the **vocabulary**: family names (`types.ts`), extensions and content
types (`media.ts`), and what a search query means including its limit (`catalogue.ts`).

## A picker filters by extension, never by `audio/*`

`AUDIO_ACCEPT` is the extension list spelled for an `<input type="file">`, and every audio picker in
the studio uses it — the media library's and the rehearsal pages'. `audio/*` is not a substitute: iOS turns it into its own
file-type test, and a file the Files app does not tag as audio — a FLAC or an Opus in iCloud Drive,
anything synced without its type — is drawn greyed out and cannot be picked. An extension iOS
matches by name. The list is also what the library takes, so a picker never offers a file the
upload would then refuse.
