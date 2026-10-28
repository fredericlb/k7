# Serving what users uploaded

Every byte these routes stream back — a session's recording, a moment's clip, a published version
and its stems — was sent by somebody, and some of it is served on k7's own origin to
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

## Uploads are on disk and bounded

Every route that takes a file takes it on disk (`diskUpload`), never in memory, and removes what it
did not keep whatever it answered (`src/uploads.ts`). A take, a mixdown and its stems are capped
at the shared 1 GiB. Past a limit the answer is 413, an unexpected file field 400 (`src/errors.ts`).

## An id that names a file is one plain segment

Ids become file names — a moment's clip in the cache — so the store refuses
any id outside `[\w-]+` before it writes a row (`SAFE_ID`, `src/sqlite.ts`), and the moment door a
paired machine shares through checks the id it is given before anything else (`momentShare.md`).
