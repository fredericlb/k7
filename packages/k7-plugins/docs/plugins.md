# k7's builtin plugins — the two composition lists

This package holds no behaviour: it holds the **lists** a plugin is installed through, in the
order features migrate off the core (`docs/sdk.md` holds the contract and the choices):

- `server.ts` — `BUILTIN_PLUGINS`, installed by the **file-service at boot**, before anything
  reads a command catalogue or compiles a song. Contributes: commands, surface types.
- `browser.ts` — `BROWSER_PLUGINS`, registered by the **shell** (`apps/k7/frontend`'s
  `plugins.ts`) into its pane registry. Contributes: pane drawers.

The lists are **independent** — a plugin may be server-only (transcription: a verb), browser-only
(turntables: a drawer) or both. What both sides share is the contract; the composition test pins
that every browser plugin carries a pane drawer, and that the server list installs silently.

## The migration order

1. **transcription** — the whisper verb; server-only, MOVED and the proof the server seam holds
   (`src/transcription/` — the verb hosts in the core `track` family, attributed at install).
2. **turntables** — the desk; MOVED (`src/turntables/`) — the drawer adapts
   `@studio/ui-turntables`, fetching its own graph off the revision token the shell injects.
3. **video** — the frame MOVED (`src/video/`): the viewport's drawer, the WebGL canvas over
   `@studio/ui-eyes`, the scene compiler, the shader-audio levels, the lens transport and the
   picture-mix arithmetic. The shell's `App` renders the plugin's `ViewportTab` directly and
   injects what the shell holds (the compiled picture, its error, the track order, the share's
   readOnly, the armed lane, the library base, the revision token).

## A drawer is fetched when it is first mounted

The composition list is imported by the shell's editor chunk, so whatever a plugin imports at its top
level is downloaded by every project. The plugin object stays eager — its id, its commands, which surface
types it draws — and the drawer behind it is `lazyDrawer` (`src/lazyDrawer.tsx`): the desk and the
compositor arrive only when a project declares a `turntables` or a `viewport` surface. The shell renders
`ViewportTab` itself, and gets the lazy one too. The Suspense is the drawer's own, so a drawer arriving
never hides the panes around it; once mounted it never suspends again, which keeps the pane invariant —
mounted once, hidden, never unmounted (`apps/k7/AGENTS.md`).

## The one surface that stays core

**The timeline is not a plugin yet, by decision.** Its drawer takes the shell's editor machinery
— the carets, the keymap, the project-doc slices, the journal — and a plugin importing any of
that inverts the dependency the whole arrangement rests on. The extraction waits on the SDK
defining that drawing context as an explicit interface; the surface type is a builtin either
way, and the device drawer stays in the shell's seed until then. Same answer for the track
modules: the `@k7-core/…` library folders are user data on disk, and a plugin "shipping modules"
would need install-time materialization into that data — a feature for when a real third-party
plugin asks for it.

A plugin that needs the shell's internals in its browser half is the boundary to watch: the
shell may hold plugin drawers, but a plugin must never import the shell.
