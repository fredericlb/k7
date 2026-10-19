# Libraries, module refs and assemblies

This page covers how a module ref resolves to a folder, where libraries are stored and versioned,
how admins edit them, and how assemblies are recorded.

## Refs and namespaces

The vocabulary is in `packages/song-schema/src/moduleTypes.ts` (no `node:fs`, so the browser
shares it):

| Namespace | Resolves to |
|---|---|
| `@engine/<slug>` | The engine's plugin scan, `<STUDIO_HOME>/exts.json`, read by `packages/song/src/engineCatalogue.ts`. No folder; the slug is `slugifyPluginName(name)` and the type folder follows the plugin's role (`categoryForRole`). |
| `@meta/...` | k7's built-ins: modules under `packages/song/meta/` and synthesised ones (`@meta/track`, `@meta/doc`, inputs and outputs). |
| `@workspace/...` | The workspace's `_modules/` folder (`SHARED_MODULES_PATH = "../_modules"` from a project). |
| `@account/...` | The account's own library, never versioned, always writable by the account. |
| `@<library>/...` | A named library. Names follow `/^[a-z0-9][a-z0-9-]{0,39}$/` and exclude the fixed namespaces. |

`MODULE_TYPES` in the same file gives each type folder its kind and default ports; `MODULE_EMITS`
what it emits. A new type folder starts there.

### Resolution

`packages/song/src/loader.ts` builds the ref map: the built-ins first (doc modules, lanes, io,
the engine catalogue), then each module root in order: the project's `../_modules`, then
`libraryFamilyRoots("modules", dir)` (the account library first, then every library by name),
then `packages/song/meta`. A root's namespace comes from where it is, never from anything the
root declares.

`extends` is folded by `packages/song/src/moduleResolve.ts`, parent under child, deepest first,
with a cycle guard. `params` and `assets` merge per key, `engines` per engine and then per param,
`rack.symbols` and `ui.widgets` per entry; the keys in `OWN_ONLY` are never inherited. Engine and
alternative selection are applied after the merge.

`module fork` (`packages/song/src/accountFork.ts`) writes an `@account/...` module that extends
the library one and repoints the project at it.

## Storage and versions

| Concern | Where |
|---|---|
| Library home, versions, pins, the root a name resolves to | `packages/song/src/sharedFolders.ts` |
| Version manifest (`library.k7x`: `name`, `version`, `requires`, `notes`) and `LIBRARY_LEVEL` | `packages/song-schema/src/libraryVersions.ts` |
| The workspace's pins (`_library-pins.k7x`), written once | `packages/file-service/src/libraryPins.ts` |
| `library versions`, `library upgrade` | `packages/commands/src/verbs/library.ts` |
| The origin's list, seeding, drafts, publishing | `packages/file-hub/libraries.ts` (`LibraryStore`) |
| Routes for the list and publishing | `packages/file-hub/librariesRoutes.ts` |
| The public read-only listing of `k7-core` | `packages/file-hub/publicLibraries.ts` |

A library is `<home>/<name>/{1,2,...,draft}/`, the home being `$STUDIO_LIBRARIES_HOME` (set by the
file hub) or `<studioHome>/libraries`. Each version holds the families `modules`, `chains`,
`assemblies`, `presets`, `samples`, `irs`, `wavetables`, `models`.

`libraryRoot(name, from)` picks, in order: the account home for `account`; the version the reading
path is already inside; the workspace pin; the admin overlay (the draft); version 1. Reading from
inside a version first is what keeps a library's own `extends` consistent within that version.

**Why versions and pins.** A library is shared by every account of the origin. Without pins, an
admin's edit would change the sound of every song on the server at once. A published version is
immutable, and each workspace moves its pin when it chooses; `forksWhoseBaseMoved` reports the
forks whose original changed so the user can listen again.

### Seeding

The file hub keeps one list (`<dataRoot>/libraries.json`) and one folder per library. A listed
library with no folder is copied from `$STUDIO_LIBRARY_SEED` (`name=dir,...` or a parent folder)
as version 1, or created empty. The desktop app sets the seed to its bundled `k7-core`
(`apps/k7-standalone/src/main.ts`); the bundle script `apps/k7/backend/scripts/bundle.mjs` packs
the newest published `k7-core` from the origin, falling back to the repository's `k7-core/`.

`k7-core/` in this repository is that seed. A module and the engine code it relies on change in
one commit.

## Admin editing

- Admin is decided in `apps/k7/backend/src/media/fileHub.ts`: the OIDC `groups` claim intersects
  `$AUTH_ADMIN_GROUPS`. The hub forwards it to the account's file service.
- On `POST /open`, the file service calls `refreshLibraries(admin)`
  (`packages/file-service/src/libraries.ts`), which syncs with the hub and, for an admin, sets
  overlays pointing every library at its `draft/` (`setLibraryOverlays`).
- Library files are addressed at the virtual path `_libraries/<name>/...` in every workspace
  (`packages/file-service/src/workspace.ts`). `assertLibraryWritable` refuses a non-admin, and
  refuses everyone on a published version.
- `PUT /account/libraries` and `POST /account/libraries/<name>/publish` are admin-only. The page
  is `apps/k7/frontend/src/projects/LibrariesPage.tsx`, calling
  `apps/k7/frontend/src/projects/api.ts`.
- The Libraries tab of the file tree is built from `GET /module-libraries` by
  `apps/k7/frontend/src/libraryTree.ts`; the upgrade banner is
  `apps/k7/frontend/src/components/LibraryUpgrades.tsx`.

## Presets

Presets are files in a tree beside the modules: `_presets/` in the workspace, `presets/` in a
library, at `<root>/<namespace>/<module path>/<name>.k7x`. Vocabulary and schema:
`packages/song-schema/src/presets.ts`; reading and writing: `packages/song-edit/src/presets.ts`;
verbs: `packages/commands/src/verbs/preset.ts`. Applying a preset writes into the node's file and
reaches the engine as a values-only diff.

## Assemblies

| Piece | Where |
|---|---|
| Template schema (`label`, `inputs`, `outputs`, `params`) and instance record (`uses`, `members`) | `packages/song-schema/src/yaml/assemblySchema.ts`, `packages/song-schema/src/yaml/assemblyFile.ts` |
| Resolution to `GraphDoc.assemblies` | `packages/song/src/assemblies.ts` |
| `assembly new`, `delete`, `dissolve`, member renames | `packages/song/src/assemblyEdit.ts` |
| Drawing | `packages/ui-chains/src/assembly.ts` (`foldAssemblies`) |
| Template editor | `packages/ui-module-builder/src/AssemblyBuilder.tsx` |

A template is a folder under a library's `assemblies/` holding `assembly.k7x` beside an
ordinary `graph` and `nodes/`. A project instance is `assemblies/<name>.k7x` in the project.
`assembly new` copies each member to `nodes/<name>_<member>`, merges the template's wiring with the
names remapped, and refuses a clash.

The compiler never reads assemblies: they are a drawing fact, so they can never change what plays.
The reference template is `k7-core/assemblies/turntable/`.

## Tests

`npm test -w @studio/song` covers the loader, `moduleResolve`, assemblies
(`packages/song/src/turntableAssembly.test.ts`) and the library folders;
`npm test -w @studio/song-schema` covers refs and schemas (`moduleTypes.test.ts`).
