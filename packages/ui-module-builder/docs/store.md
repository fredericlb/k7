# The store — the one thing a host doesn't share

The builder is a whole screen: a code pane over `module.yaml` or `ui.yaml`, the module's
parameters under it, and the widget grid beside them. All of that is identical wherever it is
drawn, because it is about a module and no host's idea of one differs.

What differs is **who is serving the files**. There are two answers, and st0 uses both — in the
same screen, chosen by which tab of its file tree the click came from:

| | a WORKSPACE | a LIBRARY |
|---|---|---|
| server | `@studio/file-service`, on the engine's machine, cross-origin | pl8, same-origin |
| paths | workspace-relative (`modules/audio/reverb/module.yaml`) | library-relative (`modules/audio/reverb/module.yaml`) |
| auth | `x-studio-{user,workspace,engine-token}` headers | the session cookie |
| a save into a shared library | **redirected** — the module is forked into the project | written in place, for everyone |
| hosts | st0's Project tab | st0's Libraries tab, pl8's own module screen |

Those two path columns read alike and are not alike — the same string names two different files
— which is exactly the trap a shared component falls into if it builds its own paths. So it
doesn't: **every path the builder passes back is a path it was given.** It receives one `path`
prop and one `ModuleUiFile` from `moduleUi`, and it never concatenates a third. And a host
never decides which space a path is in by *looking at it*: it knows, because it knows where the
click came from.

## Five calls

```ts
read(path)          // the file's text, or null when there is none
moduleUi(path)      // the ui.yaml beside it — existing, or where it would go plus a blank grid
presets(path)       // the presets.yaml beside it, answered the same way
jsdsp?(path)        // …and the DSP source, for a module that declares one. The one optional call
hints()             // what the code pane completes against
write(path, text)   // save; may answer with where the content actually landed
```

## The library half is written once

`@studio/ui-module-builder/library-store` implements all of it over three calls — read one
file, write one file, hints — because a library serves FILES and the sidecars are siblings of
the file you were given. st0's Libraries tab and pl8's module screen both take it.

That derivation is deliberate here and deliberately *not* done over a workspace, which is worth
stating because it looks like an inconsistency. Over a workspace the SERVER decides where a
panel would go, since a shared module's panel does not land beside the copy that forked. A
library has one place for every file — the module's own folder — so there is nothing to ask.

## Read-only, and who owns the warning

`readOnly` shows the whole screen with the writing turned off: the code panes refuse keystrokes,
the grid takes no drags, no autosave is armed (`enabled: false` on all four, so each still
reports about the file it is showing), and the shelf presets are not offered — those are edits,
unlike the plugin's factory banks, which load into the plugin.

`onRequestEdit` draws the button that asks to be let in, and does nothing else: the host answers
by flipping `readOnly`. Whatever it wants to say first is its own, because a shared package
knows this module is not the project's and cannot know whose it is or what writing to it costs.
Same argument as `renderPreview`. A host that never unlocks passes nothing and gets a plainly
read-only screen.

## `publish` — a save that leaves the machine

This screen has a **Save button** (`useAutosave({ manual: true })`), unlike every text pane in
st0, and `publish` is why the distinction earns one: on a SHARED module a save is not a write,
it is a publish onto a repository other people read.

It is optional and one host implements it. st0 commits and pushes the library repository the
module lives in; a host with no such repository, or a module that is the project's own, passes
nothing and the save ends at the disk.

Called **once, after every dirty file has landed**, and never per file. The four files of a
module are one edit, and four commits for one edit is a history nobody can read. It runs only
if every file landed — `flush()` reports that, and a file held back because it would not
compile reports false, since committing a module whose `module.yaml` is still yesterday's would
put a half-edit in front of everybody.

`hints()` is allowed to be nearly empty. pl8's is: most of `Hints` describes a SONG — its
tracks, clips, chains — and a library has none of those. What survives there is the list of
modules a sibling may `extend`.

st0's Libraries tab passes the OPEN PROJECT's hints instead, over a library module, and that is
the point rather than a shortcut: a shared module is completed against the vocabulary of the
song you are in, which is more than a library could say about itself.

## Why `write` has a return type

Only one host needs it. st0 redirects a save aimed at `_modules` onto a project-local copy
and repoints the chains at it (`@studio/song`'s `docs/moduleFork.md`), so **the file being
edited moves out from under the editor**. The builder is told, and tells its host through
`onRelocated`; it does not follow the path itself, because the host also owns the title, the
engine link and whatever else was pointing at the module that was not edited.

A `ui.yaml` never comes back redirected. A panel saves in place wherever it is, shared library
included — that is the exception `Workspace.write` carves, and the reason the whole `_ui/` tree
could be deleted (`@studio/song`'s `docs/uiLibrary.md`). Nothing from the LIBRARY store is ever
redirected either: a library is one place, and nothing there forks.

## What stayed in the apps

The engine link. Only a live plugin can say what its parameters are called, what they span and
what presets it ships. st0 reaches its engine through the shell's shared socket and finds the
plugin in the OPEN project's compiled graph — for a shared module too, by its
`@st0/…` ref (`apps/st0/frontend/docs/sharedModules.md`). So those arrive as plain props
(`pluginParamNames`, `pluginParamMeta`, `presets` and the two callbacks behind the dropdown),
and a host with no engine passes nothing. The grid, the params list and the file pair work
without one; they are just less well informed.

## The header's `status` dropdown

One control on this screen changes nothing about the module's sound: **`status:`** — whether the
completions list it, list it first, or leave it out. The rule and its rationale are
`@studio/song`'s [`docs/moduleStatus.md`](../../song/docs/moduleStatus.md); what belongs here is
why it is drawn where it is and how it is written.

**In the header**, beside the module's name and its path. That is the altitude of the thing it is
about: how the palette treats this module is a fact about it as a *catalogue entry*, the same
question its name and its location answer, and not one of the parameters below.

**`favorite` is drawn "first".** What the setting does is put the module at the top of the
completions, and a person choosing between three options wants to read the effect rather than the
sentiment. The FILE keeps the schema's three words — this is a label, not a second spelling.

**Read-only shows it as text, not as a disabled dropdown.** What a locked module's status *is*
stays worth reading, while a greyed-out control invites a click that will be refused. `listed`
draws nothing there: the default is not news.

**It goes through the text, like every other structured edit here.** `statusOf` / `setStatusIn` in
`moduleUi.ts` read and write the buffer, so the dropdown shows the edit you just made — saved or
not — exactly as the code pane does, and one Save writes it with everything else. Setting
`listed` **deletes** the key rather than writing the default.
