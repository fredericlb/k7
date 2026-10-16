# Adding a command

A new action should be a command, so that it exists at once in the command bar, the help page, the right-click menus, the Commands settings page (where a person can give it a key), and on a second device. Buttons then dispatch the line rather than calling a function of their own.

First decide **where it runs**:

| It… | Goes |
|---|---|
| changes project or workspace files, or asks the engine through the file service | the catalogue: `packages/commands` |
| only changes what the shell shows (a page, a panel, a tool, a zoom) | a `ui` command in the frontend |
| needs something only the browser has (the clipboard, Web MIDI, a camera, a download) but writes through a file route | a bare-named web-local command |
| belongs to a plugin | the plugin's `commands` list |

## A catalogue verb

1. **Declare it** in `packages/commands/commands.yaml`:

   ```yaml
   - command: "track colour"
     sid: track.colour
     readable:
       en: "Set a track's colour"
       fr: "Choisir la couleur d'une piste"
     help: "set a track's colour (e.g. track colour gtr #3fa34d)"
     surfaces: [cli]
     args:
       [
         { name: track, complete: tracks },
         { name: colour, hint: "a #rrggbb colour" },
       ]
   ```

   Pick the first word for the entity the command acts on: the settings page groups by it, and the right-click menu matches on the **leading arguments** (here a `tracks` value, so it appears on a track's menu). Use `menu:` only to narrow that. Add `confirm: true` if the menu should ask first. Give every free-text argument a `hint`.

2. **Write the handler**, in a family file under `packages/commands/src/verbs/` (or a new one exported as `XXX_VERBS` and listed in `VERB_TABLES` in `packages/commands/src/commands.ts`):

   ```ts
   "track.colour": async (args, h) => {
     const [track, colour] = splitWords(args);
     if (!h.project().tracks.some((t) => t.id === track))
       return h.refuse([`no track "${track}"`]);
     // …write through @studio/song-edit, which changes the value and nothing else
     h.log([`${track} is ${colour}`]);
     await h.reload();
   },
   ```

   Refuse with a sentence that says what to do instead. Write files through the song-edit writers so an edit stays a one-line diff. The file service journals the run as one undo step on its own.

3. **Test it** with a family test over `packages/commands/src/testHost.ts`, and run `npm run test` in `packages/commands`: `commandSpec.test.ts` fails on a missing language, a description over 60 characters, an unknown provider or an argument without a hint.

4. **Use it** from the UI by dispatching the line: `void runCommand(\`track colour ${id} ${hex}\`)`. A knob-like edit that must not reload the shell uses `quietCommand`.

Nothing else is needed: the file service's `/commands` serves it to the palette and the help page, `/complete` completes its arguments from the provider, and the menu derives itself from the catalogue.

### A new completion provider

Add it to `PROVIDERS` in `packages/commands/src/providers.ts`, then give it a class in `PROVIDER_CLASS` and a hint in `PROVIDER_HINT` (both are exhaustive records, so the build tells you). The provider and class names are mirrored on the wire as the `ArgProvider` and `ArgClass` unions in `packages/web-protocol/types.ts`, which `commandSpec.test.ts` holds against the package; add the new name there too.

## A `ui` command

1. Add the name to `UI_EXACT` (or a head ending in a space to `UI_HEADS`) in `apps/k7/frontend/src/localCommands.ts`.
2. Add `ui <name>` to `LOCAL_COMMANDS`, its sentence to `LOCAL_READABLE` (both languages, 60 characters), and its arguments to `LOCAL_ARGS` in `apps/k7/frontend/src/palette.ts`. A fixed vocabulary goes in `makeListArg`.
3. Handle it in `runLocalCommand` in `apps/k7/frontend/src/App.tsx`, returning `true`.
4. If the help page should describe it, add it to `VIEW_COMMANDS` in `apps/k7/frontend/src/components/HelpPage.tsx`.
5. If a one-surface device should answer it, add it to `ExternalSurface`'s `runLocal` (`apps/k7/frontend/src/components/ExternalSurface.tsx`); otherwise it answers that it is editor-only.

`localCommands.test.ts` fails if the palette lists a line the dispatcher does not recognise.

## A key for it

Add a binding to `KEYS` in `apps/k7/frontend/src/keys.ts`. A plain string is a default a person can move; a conditional binding (`{ if: "caret_track", command: "…{caret_track}" }`, or a list tried in order) stays the app's. Conditions are computed in `App.tsx`'s `conditions` memo. Add a case to `keys.test.ts`. See [Keys, palette and menus](./14-keys-palette-menus.md).

## A plugin's verb

A plugin declares `commands: [{ sid, spec, handler }]` in its `definePlugin` (see `packages/k7-plugins/src/transcription/index.ts`). The SID may live in a core family (`track.transcribe`) or under `plugin.<id>.*`. It is installed at file-service boot by `installBuiltinPlugins`; a word or SID already taken throws at install, never at use. The Chains and plugins section covers the plugin contract.
