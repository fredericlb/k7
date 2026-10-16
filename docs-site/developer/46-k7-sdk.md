# The plugin contract (k7-sdk)

`packages/k7-sdk` defines what a k7 **feature plugin** is: a bundle of commands, surface types and
panes that lands in registries k7 already has. It is not an audio plugin; audio plugins are
modules (see the libraries page of this guide). The SDK has no runtime of its own, which is why it
is three small files:

| File | Contents |
|---|---|
| `packages/k7-sdk/src/plugin.ts` | The contract: `K7Plugin` and its contribution types, `definePlugin`. |
| `packages/k7-sdk/src/install.ts` | The server-side installer and the SID attribution. |
| `packages/k7-sdk/src/install.test.ts` | The installer against the real registries. |

Plugins are compiled in. There is no dynamic or third-party loading: a plugin exists because a
composition list in `packages/k7-plugins` names it.

## The contract

```ts
export interface K7Plugin {
  id: string;
  commands?: readonly CommandContribution[];
  surfaceTypes?: readonly SurfaceTypeContribution[];
  panes?: readonly PaneDrawerContribution[];
  modules?: readonly ModuleContribution[];
}

export interface CommandContribution { sid: string; spec: CommandSpec; handler: SidHandler; }
export interface SurfaceTypeContribution {
  type: string;
  layouts: readonly SurfaceLayout[];
  mappingSkeleton: readonly (readonly [string, string])[];
}
export interface PaneDrawerContribution { type: string; drawer: (props: never) => ReactNode; }
export interface ModuleContribution { namespace: string; }

export const definePlugin = <T extends K7Plugin>(p: T): T => p;
```

| Field | Meaning |
|---|---|
| `id` | Stable and namespaced. It prefixes the plugin's own SIDs (`plugin.<id>.<verb>`), and is what attribution records. |
| `commands` | Both halves of a verb: the catalogue row (`CommandSpec`, from `packages/commands/src/commandSpec.ts`) and the handler. A spec alone would list a command that never runs, so the type takes both. |
| `surfaceTypes` | A new kind of surface a project may declare in `surfaces/`: its type name, the layouts it accepts (`split`, `floating`...), and the mapping skeleton `project surface new` scaffolds. |
| `panes` | The React drawer for a surface type, mounted in the shell's pane ring and on a second device. Its props are typed `never` on purpose: the shell, which mounts it, is where the props are known, and any real drawer is assignable to `never`. |
| `modules` | Declared, but nothing reads it yet: neither installer serves module folders. Do not rely on it. |

## The server half

`installServerSide(plugin)` (and `installServerPlugins(list)`):

1. For each command, refuses a SID another plugin already claimed, records the attribution, and
   calls `registerVerb(spec, handler)`. `registerVerb` adds the spec to the catalogue (refusing a
   command word already there) and the handler to the dispatch (refusing a SID that already has
   one). A plugin may put its verb in a core family (`track.transcribe`) or under its own prefix.
2. For each surface type, calls `registerSurfaceType`
   (`packages/song-schema/src/yaml/surfaceRegistry.ts`), which refuses a duplicate or a type with
   no layout.

`pluginOf(sid)` answers which plugin installed a SID (undefined for a built-in).

Note an ordering hazard: the attribution and the catalogue row are recorded before the dispatch
registration can throw, so a plugin reusing a built-in SID fails loudly at boot but leaves its row
in the catalogue. Treat any throw from the installer as fatal.

Because completion and the catalogue read the registries, a contributed verb appears in the
command bar, its completions and its right-click menus (`menu:`) with no further wiring.

## The browser half

The browser installer is not in the SDK; it is the shell's. `apps/k7/frontend/src/plugins.ts`
(imported for its side effect by `App.tsx`) first seeds the core drawers
(`apps/k7/frontend/src/surfacePanesSeed.tsx`), then registers each browser plugin's `panes` with
`registerSurfacePane` (`apps/k7/frontend/src/surfacePanes.ts`). That registry refuses a duplicate
type and a type that is not registered in the browser's surface registry. Server halves register
surface types in the file service process only, so in practice a pane's type is a schema built-in
(`timeline`, `viewport`, `turntables`, `mastering`).

## Writing a plugin

1. Create `packages/k7-plugins/src/<name>/index.ts`:

   ```ts
   import { definePlugin, type K7Plugin } from "@studio/k7-sdk/plugin";
   import { shout } from "./shout";

   export const shoutPlugin: K7Plugin = definePlugin({
     id: "shout",
     commands: [
       {
         sid: "plugin.shout.say",
         spec: {
           command: "shout say",
           sid: "plugin.shout.say",
           readable: { en: "Shout a line", fr: "Crier une ligne" },
           help: "log a line in capitals (e.g. shout say hello)",
           surfaces: ["cli"],
           args: [{ name: "text" }],
         },
         handler: shout,
       },
     ],
   });
   ```

   The spec's `sid` must equal the contribution's. The handler is a `SidHandler`,
   `(args, host) => ...`, using the host for `songPath`, `log`, `refuse`, `reload`.
2. Add it to `BUILTIN_PLUGINS` in `packages/k7-plugins/src/server.ts` if it has commands or
   surface types, and to `BROWSER_PLUGINS` in `packages/k7-plugins/src/browser.ts` if it has panes.
3. Run `npm test -w @studio/k7-plugins` (`composition.test.ts` installs the server list and checks
   each browser plugin has a pane) and `npm test -w @studio/k7-sdk`.

Keep everything the verb needs inside the plugin folder, so the plugin is the unit you read,
move or remove.
