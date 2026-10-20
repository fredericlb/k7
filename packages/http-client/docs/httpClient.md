# @studio/http-client

The browser's half of a call to a studio service. Three hosts use it: the media library's screens
(`@studio/ui-library`), the rehearsal screens (`@studio/ui-rehearsal`) and k7's home page
(`apps/k7/frontend/src/projects/api.ts`). It is a package of its own because none of those three
depends on another, and the helpers belong to none of them; `@studio/web-protocol` was not the place
either, since it is the wire's vocabulary and is published to apps outside this repository.

## A refusal carries the server's sentence, and its status

Every route here answers a refusal as `{ error: "<sentence>" }`. `failed` throws THAT rather than
`mkdir 400`, because throwing the status code is how you end up staring at a number the server
already explained. The status rides along on `HttpError`, because some callers have to tell
"there is nothing there" (a 404) from "it went wrong".

The fallback, for a refusal with no sentence, is the CALLER's: a short word the status is appended
to, or a function of the status. The rehearsal screens pass a translated sentence; the media library
and k7's home page pass the call's name. The package holds no wording of its own, so it needs no
message catalogue.

## A call has a time budget; an upload has none

`fetchWithin` gives up after a budget the caller picks, and says so with the caller's own error, so
a dead link reads as a sentence rather than a spinner that never stops. A caller's own cancel stays
an `AbortError`: only the budget running out is reworded. An upload passes `null`, since a slow link
makes it long and only the user may cut it.

## An upload says how far it is

`upload` sends a body through XMLHttpRequest, because fetch reports nothing of a request body
leaving and a song or a take can weigh hundreds of megabytes: a dialogue that only spins for minutes
reads as a hang. XMLHttpRequest's `upload.onprogress` is the one browser API that says how far the
bytes are. It answers a `Response` and takes an `AbortSignal`, so the caller reads it as a fetch and
Cancel still cuts it.
