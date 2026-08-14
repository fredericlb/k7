# sharedFolders.ts — extended notes

A workspace holds folders every project in it draws from, and a project finds them **by
where they are**:

```
ws/_modules/     the shared modules   → @workspace/<type>/<name>
ws/song/         a project
~/.studio/mediatek/modules            → @st0/…
```

`moduleLibraryDirs()` answers that: what sits beside the project, then the machine's
médiathèque. Order is PRECEDENCE — nearest first.

There was a second row, `ws/_library/`, holding the assets a module could name. It is gone —
a module carries the files it loads, in its own `assets/`, so the module travels whole. See
`docs/moduleAssets.md`.

## Why nothing declares them any more

`project.yaml` used to carry `modules_from` and `libraries_from`, and `scaffold` wrote them.
The lists could only ever name those same two places, so they decided nothing — while giving
every project a way to be **wrong** about facts the loader already knew. Three ways, all seen
in one afternoon:

- a project older than the line that added `@st0` saw no médiathèque at all, and every
  `@st0/…` ref in it read as "extends unknown module" — about modules sitting right
  there on disk;
- a `_modules` folder deleted from the workspace left its declaration behind, and
  `loadModuleRefs` **threw** on a root it could not resolve: one stale line, and the whole
  song went dark;
- the same roots written twice — once in the header, once derived — drifted apart between the
  compiler and the builder's catalogue, which is how a module could play and not be listed.

Location cannot drift. A folder that is not there is simply not a root, which is why none of
these functions can fail any more: there is no header to read first, and nothing to throw.

**The fields are still ACCEPTED by the schema.** Every song already written carries them, and
refusing the key would turn a working project into one that will not open. `deadProjectFields`
reports them as a warning naming the lines to delete — because "accepted and silently ignored"
is the failure mode this codebase keeps paying for.

## Where a panel lives — and why there is no list for it

A module's UI panel is the `ui.yaml` in the module's own folder (see uiLibrary.ts). It used
to be a parallel tree, found at one hard-coded place, `../_ui` — fine while there was
exactly one library, wrong the moment a project can also draw modules from a médiathèque
outside the workspace, and wrong again once you notice the panel and the module could
disagree about which module the panel drew.

`modulePanelRoots()` is what is left of that machinery: the project's own `modules/` first,
then the shared roots. There is nothing panel-specific about it any more — it is the list of
module libraries, and the panels are in them.

Deriving beats declaring here, and putting the file in the folder beats deriving. A panel is
not an independent asset like an impulse response; it is the face of a module, so it travels
with the module itself — and a library brings its faces along with nothing to write down.

**Order is precedence.** `loadUiLibrary` reads every library, nearest first, so a project
that forked a shared module draws its own face rather than the one it was copied from. What
is gone is the write-one half of the old rule: `writeUiFile` writes the panel where its
module is, shared library included. See `docs/uiLibrary.md` for why that exception exists
and what it costs.

`moduleNamespaceOf()` lives here too, because it is the one fact that separates the two kinds
of root: the médiathèque's modules key as `@st0/…`, anything else as `@workspace/…`, and
a project's own `modules/` keys bare. Everything that turns a folder into a ref, or a ref back
into a folder, turns on that — and it asks the PATH, never a declaration. See
docs/moduleNamespaces.md.
