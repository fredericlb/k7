# libraries.ts — the origin's libraries, as one account's service sees them

The origin has ONE list of libraries, each a FOLDER with a NAME: `k7`, `drums`. The file hub holds
the list and the folders, and their choices are in `packages/file-hub/docs/fileHub.md`. This service
reads those folders (`$STUDIO_LIBRARIES_HOME`), and `@<name>/<type>/<module>` resolves against them
from every workspace of the account. No workspace holds a copy. The layout and why nothing declares
it is in `packages/song/docs/sharedFolders.md`.

## Asking the hub: `askHubSync`

`POST /open` (`refreshLibraries`) calls `POST $STUDIO_HUB_URL/libraries/sync` with this service's
hub secret, which gives every listed library its folder before the song is read. With no
`$STUDIO_HUB_URL` — which only tests run — the libraries are whatever the folder holds.

`/account/libraries` never reaches this service: the hub answers it.

**Nothing is created before the origin has a library.** `POST /workspaces` and the bench refuse
with the same sentence: a workspace made without a library is a folder whose chains and modules
point at nothing, and the refusal has to come before the folder exists rather than at the first
open. `Examples` is not a user gesture and is not gated.

## Only an admin writes a library, and only its draft

A library is every account's, so a write into one is everybody's at once. Every write that lands
in a library is refused (`Workspace.assertLibraryWritable` in `../src/workspace.ts`;
`writeNodePreset` in `packages/song-edit/src/presets.ts` for `node preset save … <library>`; the
`/command` route for a verb whose `at` is in a library) — unless `isLibraryEditable(name)`.

`refreshLibraries(admin)` decides that at each open, from the hub's admin header: for an admin every
library on disk is OVERLAID onto its `draft/` (`setLibraryOverlays`), which the hub makes on that
ask; for anyone else nothing is. A published version is refused to everybody
(`isLibraryRootEditable`), with a message saying to edit the draft. The refusal says that only the
origin's admins edit a library. That covers every gesture of the file tree, the builder's Save and
a chain edited from the Libraries tab alike, from any project.

The write reaches the draft only: a workspace hears it once it pins `draft`, or once the draft is
published as a version and the workspace pins that (`docs/library-versions-plan.md`). The hub relays
every change to the library's k7fs room, whose log is its history. An unresolved
`@<name>/…` ref is still not a compile error (`packages/song/docs/sharedFolders.md`), so a library
that starts empty breaks nothing.

A chain's bench (`/@banc/<chain>/live.k7`) edits no library and changes no overlay.

`_libraries/account/…` is the account's OWN library, written by its account like `_modules`, never
refused. It syncs as one more room of the account, `_account`, attached at start beside the
workspaces (`attachAccountLibrary` in `../src/workspaces.ts`) and kept out of every list of
workspaces, since it is none.
