# Moving a library module

In st0's Libraries tab a module row drags onto another folder of its library. That is a move of the
module's folder, and something more: **a module's ref is its path**, so `@st0/audio/delay/echo`
moved to `time/` becomes `@st0/audio/time/echo`. A move is a rename of the ref.

## Its refs follow it

Every `extends:` that named the old ref would otherwise resolve to nothing: a `?` on the graph and
a node that plays nothing, in every song that used it. So the move repoints them (`repointRefs`):

- in **the library itself**: its chains, its assemblies and its other modules;
- in **the open workspace**: every project in it.

The rewrite is textual on purpose. A ref appears quoted, bare, as a chain step with a node
(`ref:node`) or a port (`ref#b`), inside flow lists and in comments. Reserialising YAML to reach all
of those would eat every comment in hand-edited files. The pattern ends a ref at one of the
characters that can follow it, so moving `echo` never touches `echo-2`. A song's `_history/`, the
recycle bin and a stale `_libraries/` clone are not walked: none of them is something that plays.

**What it cannot reach** is any other workspace, and any other account using the library. They
keep the old ref until someone repoints them; `scripts/migrateToEngines.ts` takes a map of old ref
to new and can do it in bulk.

## Where a module may go

`planModuleMove` refuses, with the reason, any move the loader could not read back:

- **Into the same library.** Another library is another repository, and a ref names its library.
- **Into the same type.** `audio/` to `instruments/` changes what the module IS: its ports and its
  kind come from that folder ([moduleTypes.md](moduleTypes.md)).
- **Into the type folder or one category below it.** The loader reads no deeper, so a module put
  further down would not be found.
- **Onto a folder, never into a module**, and never over a module of the same name.
- **Never an engine on its own.** An engine belongs to its module's folder
  ([engines.md](engines.md)); it moves when the module does.

## After the move

The host publishes the library, as it does after a rename or a delete: a library is its repository,
and a move is a change to it. The workspace files that were repointed are left as edits in that
workspace, for its own commit.
