# Libraries

A **library** is a named collection of shared material: modules, chains, assemblies, presets,
samples, impulse responses, wavetables and amp models. Every project on the server reads the
same libraries, so a module improved in a library is improved for everyone who plays that
version.

k7 will not open a project until the server has at least one library. An empty library is
enough.

## The libraries you meet

| Level | Ref | Who writes it |
|---|---|---|
| `k7-core` | `@k7-core/...` | The server's admins. It is the default library, seeded from the module collection that ships with k7. |
| Other libraries (`@drums`, `@vocals`...) | `@<name>/...` | The server's admins. |
| Your account library | `@account/...` | You. It is never versioned, and is where `module fork` puts your copies. |
| The workspace | `@workspace/...` | Anyone working in the workspace. It is the `_modules/` folder at the workspace root. |
| The engine | `@engine/...` | Nobody: it is the list of plugins the engine found on its machine. |

A library name is lowercase letters, digits and `-`, up to 40 characters, and cannot be one of
`engine`, `workspace`, `account`, `meta`, `studio` or `mediatek`.

When the same module path exists at several levels, the nearest wins: the workspace first, then
your account library, then the libraries in name order.

### What a library contains

| Folder | Contents |
|---|---|
| `modules/` | Modules, by type folder (`audio/`, `instruments/`, `transformers/`, `cold/`, `console/`...). |
| `chains/` | Ready-made chains, such as a live vocal chain or a normalize pass. |
| `assemblies/` | Assembly templates. See [Assemblies](./47-assemblies.md). |
| `presets/` | Presets, by the module they belong to. |
| `samples/`, `irs/`, `wavetables/`, `models/` | Sounds, impulse responses, wavetables and amp models that modules load. |

## Using a library module in a project

A node names its module with `extends`:

```js
// nodes/vox.k7x
extends("@k7-core/audio/compressor")
engine("tracktion")
engines({ tracktion: { params: { Ratio: 0.125 } } })
```

The node keeps only what differs from the module. When the library's module changes, the node
follows, keeping its own values.

To change the module itself rather than one node, either fork it into your account
(`module fork @k7-core/audio/compressor`) or, if you are an admin, edit the library.

## Versions

A library has numbered versions (`1`, `2`, ...) and, on the server, a **draft** that admins edit.
A published version never changes.

Each workspace **pins** the version of each library it plays, in `_library-pins.yaml` at the
workspace root. A workspace that pins nothing plays version 1. Upgrading is a choice made per
workspace, so a song never changes sound because someone published a new library version.

| Command | What it does |
|---|---|
| `library versions` | For each library: the version pinned here, the versions available, and whether a newer one is ready. |
| `library upgrade <library> [version]` | Move the pin. With no version, to the newest one this k7 can run. `draft` pins the draft. A version that needs a newer k7 is refused. |

When a newer version is ready, a line above the file tree offers to upgrade. If the pinned
version needs a newer engine than the one playing, that line says so. After an upgrade, k7 lists
your forks whose original moved, so you can listen to them again.

## Browsing libraries

The file tree has a second tab, **Libraries**, with one row per level, nearest first. Click a
module to open it in the [module builder](./45-module-builder.md). On a level you can write, the
right-click menu offers **New folder...** and **New module...**. The `@engine` level is greyed:
its rows name plugins, with no file behind them.

## Editing a library (admins)

Admins are the members of the server's admin groups. For them:

- Every library opens on its **draft**, writable in place from any project. Saving a module in
  the builder writes the draft directly; nothing is forked and no song is touched.
- A workspace hears the change once it pins the draft, or a version published from it.
- For anyone else, writing to a library is refused ("only the origin's admins edit a library").
  Writing to a published version is refused for everyone.

### The Libraries page

The home page's sidebar links to **Libraries** (`/libraries`). There, admins:

1. **Add** a library by name. If the shipped seed holds a library of that name it is copied from
   it; otherwise it starts empty.
2. **Remove** a library from the list.
3. **Publish draft**: freeze the draft as the next version, with a note of what changed and the
   lowest k7 level that can run it.

Everyone else sees the list, its versions, and "Only the server's admins edit the libraries."

## Library chains

A library's `chains/` folder holds chains you can reuse: a vocal chain for a live input, a
`normalize` pass for processing a file. Opened from the Libraries tab, a chain is shown as text
beside its graph, drawn with the same chains view as a project.

```js
// k7-core/chains/process/normalize.k7x
steps([
  id("ba2a1f1b-e497-433f-a7c3-2695e95ba40a")
    .extends("@k7-core/cold/normalize")
    .params({ Target: -1 }),
  to([chain("@out")]),
])
```
