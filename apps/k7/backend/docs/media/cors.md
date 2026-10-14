# CORS is open, on purpose

`openCors` (`apps/k7/backend/src/media/cors.ts`) answers every origin's credentialed request
rather than checking one against a list, and `server.ts` applies it to the whole process before
anything else runs. k7's own pages are same-origin and never need it; the callers that do are the
other studio pages reaching the library from another origin — z0's editor among them — and those
are exactly the ones an allowlist breaks in ordinary ways this deployment hits: a dev server reached
on its own port, a new subdomain, a machine reached by IP during setup.
Every one of those is a legitimate caller a list would not yet know about, and the failure mode is a
CORS error with no server-side log to explain it.

## What that costs

A response cannot carry both `Access-Control-Allow-Origin: *` and credentials — the browser
itself refuses the combination — so answering every origin means **reflecting** whichever one
asked (`res.setHeader("Access-Control-Allow-Origin", origin)`), not a wildcard. Any page a
signed-in user's browser visits can make a credentialed request here and read the response,
which is the CSRF-shaped surface an allowlist exists to close.

Two things keep that surface narrow rather than closing it:

- Every mutating route already sits behind `bearerOrSession(requireAuth)` or `requireAuth`
  (`mount.ts`, `server.ts`) — a page on another origin can *ride* the session cookie, but it was
  already going to need one, and the library holds media rather than money or credentials.
- The bearer scheme ([gate.md](gate.md)) is what a headless caller uses anyway; the cookie path
  this opens up is the one a browser was always going to present regardless of what CORS says, on
  a plain `<img>` or a form post — CORS governs whether the *response* can be **read**, not whether
  the request can be **sent**. Opening it stops hiding a read that a same-site trick could already
  get most of, and buys back the debugging cost an allowlist charges.

## The headers are a list

`Access-Control-Allow-Headers` names what a page actually sends, not whatever it asks for: the
file hub's calls (`/api/files`, `packages/file-hub/docs/fileHub.md`) carry the user, workspace,
engine-token and engine-id headers, so those are listed. The hub secret is not: a browser never
holds it, and a preflight asking for it is refused rather than answered.
