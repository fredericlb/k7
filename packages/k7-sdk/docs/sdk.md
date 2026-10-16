# The k7 SDK — a plugin is a contribution, not a process

One `K7Plugin` a feature declares, through `definePlugin`; one installer per side that lands it
in registries that **already existed**. The SDK has no runtime of its own, no loader, no
sandboxing — the four registries are its whole surface, and a plugin is a set of contributions
to them:

| a plugin may contribute | registry it lands in | who reads it |
|---|---|---|
| commands (`CommandContribution`) | `@studio/commands` — catalogue + SID map, one installer (`registerVerb`) | the file-service's dispatch; every palette and menu |
| surface types (`SurfaceTypeContribution`) | `@studio/song-schema/yaml/surfaceRegistry` | `project surface new`, the completion provider, the scaffolder |
| pane drawers (`PaneDrawerContribution`) | the shell's pane ring | the shell's pane and a device's mount |
| module folders (`ModuleContribution`) | the médiathèque's module library | the graph, the module builder |

## CHOICES

**The registries live in the seams, not in the SDK.** song-schema's surface registry, the
commands package's installer and the shell's pane ring each hold their own registry; the SDK
holds the contract and calls them. Where the registry lives decides who may read it without
importing plugin code — song-schema must stay the data-only tier every app imports, so ITS
registry is seeded with the four builtins and opened, never moved.

**One SID, one behaviour, attributed at install.** A plugin's verb may live in a CORE family —
`track.transcribe` in `track.*` is the normal case, the plugin extending the family the words
already belong to — or under its own `plugin.<id>.*` prefix. Either way the installer records
which plugin claimed the SID (`pluginOf`), a SID a plugin holds is refused to every other
plugin, and command WORDS are refused when taken — one word, one verb, the same rule the
builtins' yaml already obeys.

**A drawer is typed where it is mounted.** The SDK's `PaneDrawerContribution` takes `never` —
the bottom type, which any real drawer assigns to — because the props a drawer gets are the
SHELL's to know: the pane mount (hidden-and-shown, a long-lived ring slot) and a device's mount
(fullscreen, whole-ctx) pass different things, and both are the shell's invariants. Defining
them here would make the SDK import the shell or the shell import the SDK, and the second is
the one that is true; the first would drag app internals into the shared tier. The drawer a
plugin declares must be usable in BOTH mounts — its props are a structural subset of each ctx,
and what it needs beyond the subset (the graph fetch, the library base, the revision token) it
takes from the ctx the shell injects or builds from shared packages. Distinct per-mount drawers
would fork the registry's contribution shape, and no plugin has needed one yet.

**The engine is out of scope, stated once.** A plugin cannot add an engine module TYPE without
C++ work in k7-runtime. The honest paths for sound are what exist: library modules the plugin
ships into the médiathèque, and `@studio/dsp`-authored modules the engine already executes.
`docs/audit-moteur.md`'s boundary applies unchanged.

**The Zod surface schema stays the BUILTINS' enum for now.** `SurfaceSchema` narrows `type:` to
the four builtins; a plugin-registered type is listed, completable and scaffoldable, but a
project declaring one does not parse until the schema reads the registry too. Widening a parsed
shape is the day a registered type actually ships — doing it sooner would trade a compile-time
guarantee (the seeded enum) for a runtime one nobody yet exercises.

**No runtime loading, yet.** Plugins are in-repo TypeScript the composition point imports.
Everything the four first examples need (transcription, turntables, timeline, video) is core
functionality, which needs attribution and versioning, not loading — and a loader without a
second consumer is machinery that nothing tests.

## Where installation happens

- **Server** — `installServerPlugins(BUILTIN_PLUGINS)`, called once at the file-service boot,
  before anything reads a catalogue or compiles a song. The plugin list is
  `@studio/k7-plugins/server`'s to hold; the file-service does not name plugins.
- **Browser** — the shell's composition point (`apps/k7/frontend`) imports
  `@studio/k7-plugins/browser` and registers each plugin's drawers through its pane registry.

A plugin is two files along the same line: `server.ts` (commands, surface types) and a browser
half (panes). Most plugins have only one.
