# The store — the one thing the two apps don't share

The builder is a whole screen: a code pane over `module.yaml` or `ui.yaml`, the module's
parameters under it, and the widget grid beside them. All of that is identical in pistes and
in the médiathèque, because it is about a module and neither app's idea of one differs.

What differs is **who is serving the files**.

| | pistes | médiathèque |
|---|---|---|
| server | `@studio/file-service`, on the engine's machine, cross-origin | its own backend, same-origin |
| paths | workspace-relative (`modules/audio/reverb/module.yaml`) | library-relative (`modules/audio/reverb/module.yaml`) |
| auth | `x-studio-{user,workspace,engine-token}` headers | the session cookie |
| a save into a shared library | **redirected** — the module is forked into the project | written in place |

Those read alike and are not alike, which is exactly the trap a shared component falls into
if it builds its own paths. So it doesn't: **every path the builder passes back is a path it
was given.** It receives one `path` prop and one `ModuleUiFile` from `moduleUi`, and it never
concatenates a third.

## Four calls

```ts
read(path)          // the file's text
moduleUi(path)      // the ui.yaml beside it — existing, or where it would go plus a blank grid
hints()             // what the code pane completes against
write(path, text)   // save; may answer with where the content actually landed
```

`hints()` is allowed to be nearly empty. The médiathèque's is: most of `Hints` describes a
SONG — its tracks, clips, chains — and a library has none of those. What survives is the asset
list a widget's `library` dropdown offers.

## Why `write` has a return type

Only one host needs it. pistes redirects a save aimed at `_modules` onto a project-local copy
and repoints the chains at it (`@studio/song`'s `docs/moduleFork.md`), so **the file being
edited moves out from under the editor**. The builder is told, and tells its host through
`onRelocated`; it does not follow the path itself, because the host also owns the title, the
engine link and whatever else was pointing at the module that was not edited.

A `ui.yaml` never comes back redirected, from either host. A panel saves in place wherever it
is, shared library included — that is the exception `Workspace.write` carves, and the reason
the whole `_ui/` tree could be deleted (`@studio/song`'s `docs/uiLibrary.md`).

## What stayed in the apps

The engine link. Only a live plugin can say what its parameters are called, what they span and
what presets it ships, and each app reaches its engine its own way — the médiathèque through
`useModuleEngine`, pistes through the shell's shared socket. So those arrive as plain props
(`pluginParamNames`, `pluginParamMeta`, `presets` and the two callbacks behind the dropdown),
and a host with no engine passes nothing. The grid, the params list and the file pair work
without one; they are just less well informed.
