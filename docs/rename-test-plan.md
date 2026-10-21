# Recipe for a rename

Renaming an application, a service or a protocol prefix in this repo touches things that do not
complain when they break: a state directory, a sentinel in the engine's output, an HTTP header, an
identifier written into a user's file. Most of those faults read as an empty file rather than an
error. This page holds the **method**; it describes no particular rename.

## The two rules

**The order is fixed.** Each phase assumes the previous one green. A failing phase makes the ones
after it uninterpretable, because the base is shared: an engine writing its catalogue to the wrong
place produces an empty médiathèque, and the fault gets hunted in the wrong app.

**Every check carries its failure signature** — what you would see *precisely* if the rename were
wrong at that point. Without it, "it seems to work" proves nothing. The most useful signature is
the one that looks like normal operation: "the engine starts but finds no workspace" is
indistinguishable from a legitimate first launch, and that is exactly why it has to be written
down in advance.

## The phases

1. **The state directory** (`<state>`) — blocking, and done by hand. Nothing starts correctly
   until the content has moved. Move the *content*, not the directory. The merged log and
   `engine.pid` are not carried over: the log is truncated on every launch and would keep only
   lines written by the previous engine — including a banner under the old name, which reads as a
   broken rename. A stale `engine.pid` pushes a fresh supervisor into adopting a dead engine
   rather than starting one. What does not regenerate is `root/`, which holds the workspaces.
2. **The engine alone** — build, unit tests, device enumeration, plugin scan. No supervisor, no
   browser. The output sentinels (`STUDIO_*_BEGIN` / `_END`) are what the TypeScript looks for to
   bound a reply: a sentinel under the old name gives an engine that answers and a caller that
   reads empty.
3. **Supervisor and file service** — the shared base. This is where the
   `x-studio-{user,workspace,engine-token}` headers are checked: the guarded route must answer
   with the new headers **and refuse** the old ones. A refusal, 401 or 400; if the list comes
   back, an old header is still somewhere.
4. **The tray**, if the packaged build is in use. The supervisor from the previous phase is
   interchangeable with the one it drives on the same contract, so this phase is optional.
5. **Each application, one by one**, from the smallest consumer of the base to the largest. The
   order matters: an app holding its own engine registry proves nothing about the one next door.
6. **Non-regression** on the apps that consume `packages/*` without having been the rename's
   target. A consumer of the headers outside the base is the last place a partial rename shows,
   so the first to check here.

## The check that matters most

A rename touching an identifier **written into a user's file** is not of the same order as the
others: the repo can be green and that person's projects broken. Those need a migration and a
readable failure signature — see
[packages/song/docs/moduleNamespaces.md](../packages/song/docs/moduleNamespaces.md) for the module
level, the only one of this family.

The corollary: an identifier nobody types and that never leaves the machine renames without a
migration, and sometimes does not rename at all — a migration on every machine for an invisible
word does not pay.

On the engine's built-ins, the check reads on `complete`, not on `params`: a built-in created
successfully returns an empty `params` for some types, which says nothing. `dumpPluginParams`
emits `complete:false` and exits **2** when `createNewPlugin` returns `nullptr`, i.e. when the
type is not found. `resolveBuiltInType` (`engine/EditBuilder.cpp`) accepts either the display name
or the internal identifier, so a `module.k7x` written in the human form survives an id rename.

## What legitimately starts from zero

Not to be mistaken for a fault. The list is drawn up *before* renaming, because each of these
lines produces a symptom that would otherwise be taken for a bug:

| | why |
|---|---|
| a re-login | the session cookie changes name |
| the workspace choice | localStorage key renamed |
| the web-UI allowlist (`<state>/web-origins.json`) | it lives IN the state directory, so a moved `<state>` starts deny-by-default. It shows as a **403 on the OPTIONS preflight**, which reads as a broken app rather than a permission — the origin is in `pending-origins.json`, and moving it into `web-origins.json` allows it |
| per-service preferences (`<state>/prefs/<service>/`) | directory renamed |
| a blank `%APPDATA%/Studio/Settings.xml` | JUCE application name renamed — the supervisor switches back to the right device on the first poll cycle |
| Tracktion's channel aliases and MIDI defaults | same cause; input labels come from `preferences.yaml` and are intact |
| the tray seen as a new application | bundle identifier renamed: a startup item points at the old one and has to be redone |

## What does not rename

`lane` is the word for a row of clips on the timeline: a song has `tracks` **and** `lanes`. The
`<Lanes>` elements the DAWproject import parses belong to somebody else's format, and `biPlanes`
is a field of Win32's `BITMAPINFOHEADER`. A rename sweeping on the word rather than on the
identifier takes all three with it.
