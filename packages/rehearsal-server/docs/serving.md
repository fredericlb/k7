# Serving what users uploaded

Every byte these routes stream back — a session's recording, a moment's clip, a published version
and its stems, a song's sheet — was sent by somebody, and some of it is served on k7's own origin to
anyone holding a public page's link (`pages.md`). A file served with a type a browser renders as a
document runs its script on that origin, with the visitor's session. So the type a file goes out
under is the SERVER's choice, never the one the upload carried. `src/serve.ts` is the one place
that streams; no route calls `streamFile` itself.

## Audio: checked on the way in, typed by its extension on the way out

- **An upload that does not say `audio/*` is refused** (400) on every route that takes one: a
  release, a version, a version's replacement, an import's mixdown and stems, a session's take, a
  song's reference track.
- **The `Content-Type` is read off the file's extension**, the extension the server itself filed it
  under (`audioMimeOf`, over the médiathèque's `MIME_BY_EXT`), and never off the `*Mime` column the row stores. Those columns hold what
  the client said; they are kept for the file names a download is given, and serve nothing. An
  extension outside the audio table goes out as `application/octet-stream`.
- **Every response carries `X-Content-Type-Options: nosniff`**, so a browser never second-guesses
  that type into HTML.

Checking on the way in alone would not be enough: rows written before the check, and copies brought
from another server, carry whatever type was sent then.

## Sheets: drawn, never opened as a page

A sheet is a PDF, an image or a score (`../../rehearsal-shared/sheetKind.ts`), and an image may be
an SVG, which is a document that can carry script. Each kind goes out under `sheetServedMime`:

| kind | served as | why |
|---|---|---|
| PDF | `application/pdf`, `nosniff` | drawn in an `<object>`; a browser's PDF viewer runs no script on this origin, and refuses to draw at all inside a sandbox |
| image, SVG included | its image type, `nosniff`, `Content-Security-Policy: sandbox; default-src 'none'; …` | drawn by an `<img>`, which ignores the policy; the same URL opened as a page runs nothing |
| score (MusicXML, Guitar Pro) | `application/octet-stream`, the same policy | alphaTab `fetch`es the bytes, so no type is needed, and an XML type is one a browser would render |
| anything else | `application/octet-stream`, the same policy | a copied row may name a type no upload would pass |

The EPUB and PDF exports `fetch` a sheet and read its kind off the name, so a score's
`octet-stream` costs them nothing.

## Uploads are on disk and bounded

Every route that takes a file takes it on disk (`diskUpload`), never in memory, and removes what it
did not keep whatever it answered (`src/uploads.ts`). Sheets are capped at 50 MB a file and twenty
files a request; a song's reference track at 500 MB; a take, a mixdown and its stems at the shared
1 GiB. Past a limit the answer is 413, an unexpected file field 400 (`src/errors.ts`).

## An id that names a file is one plain segment

Ids become file names — a sheet under `sheets/`, a moment's clip in the cache — so the store refuses
any id outside `[\w-]+` before it writes a row (`SAFE_ID`, `src/sqlite.ts`), and the moment door a
paired machine shares through checks the id it is given before anything else (`momentShare.md`).
