# Testing and extending the media and rehearsal code

## Running the tests

Each package runs vitest on its own:

```bash
npm test -w @studio/mediatek
npm test -w @studio/ui-library
npm test -w @studio/rehearsal-server
npm test -w @studio/ui-rehearsal        # compiles the paraglide catalogue first
npm test -w @studio/rehearsal-shared
npm test -w @studio/lyrics
npm test -w @studio/tablature
npm test -w @studio/score
npm test -w @studio/mpv-player
npm test -w k7-backend                  # the media routes, hunt, stems, sweeps
```

`npm test` at the root runs every workspace. `@studio/recorder`, `@studio/ui-mini-player` and
`@studio/stem-separation` have no tests.

What the tests cover is pure logic and HTTP routes against temporary folders (`STUDIO_MEDIATEK`,
`STUDIO_SETTINGS_DIR`, `STUDIO_HUNTS_DIR`, `K7_DATA_DIR`). **No test mounts a React component.** A
change to a screen is checked by running k7 (`npm run dev`) and using it in a browser.

Before committing, `npm run lint` (biome) must pass on every touched TypeScript file, and
`npm run lint:docs` checks that no prose names a file that is not there.

## Recipes

### A new field on a song

1. If it describes the music, it is a tag: add it to `MasterTags` (`packages/mediatek/src/types.ts`)
   and to `WIRE` in `packages/mediatek/src/tags.ts`, which names TagLib's property for it. If it
   describes the folder, it is a sidecar key, edited as text in `packages/mediatek/src/write.ts`.
2. Read it in `scanSongs` (`packages/mediatek/src/scan.ts`) into `meta`: `meta` holds scalars only.
3. Test it in `packages/mediatek/src/tags.test.ts` or `song.test.ts`.

### A new media library route

Add it to `libraryRouter` (`apps/k7/backend/src/media/routes/library.ts`) with `wrap`, map caller
errors to 400 or 409 explicitly, and add the client call to `packages/ui-library/src/api.ts`.
Uploads go through `rawToDisk()`, never `express.raw`. Cover it in
`apps/k7/backend/src/media/routes/library.test.ts`. If the local file service must answer the same
question, mirror it in `packages/file-service/src/routes/mediatek.ts`.

### A new playback destination

One entry in `PLAYBACK_TARGETS` (`packages/ui-library/src/playback/targets.ts`), its label and hint
in `LibraryLabels.playback.targets` and k7's `mediaLabels.ts`, and its branch in
`PlaybackProvider.tsx`. The id is stored on accounts: never rename one.

### A new rehearsal collection or field

Add it to `packages/rehearsal-server/src/schema.ts`; no migration is needed. Write the store
function in the entity's module under `packages/rehearsal-server/src/store/`, re-export it from
`src/store.ts`, and add the route under `src/routes/`. Shared types go to
`packages/rehearsal-shared/types.ts`.

### A new rehearsal screen

Add the route in `packages/ui-rehearsal/src/routes/RehearsalRoutes.tsx`, navigate with
`useRehearsalNav()`, and if it is a new sidebar entry add it to `REHEARSAL_SECTIONS` and
`rehearsalSectionAt` (`src/sections.ts`). Every sentence goes in `messages/en.json` and
`messages/fr.json`. Wrap it in `ServerOnly` if its data lives on the server alone.

### A new sheet format

Recognise it in `packages/rehearsal-shared/sheetKind.ts` (by extension when browsers send it as
`application/octet-stream`), then in the library's song page (`packages/ui-library/src/useSongAttachments.ts`)
whether it is accepted and in `packages/ui-rehearsal/src/components/SheetPanel.tsx` how it is drawn.
