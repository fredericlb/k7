# Shell state: what lives in a store, what stays local

The shell holds three kinds of state, and each has one home.

| kind | home | read by |
|---|---|---|
| the engine's live state (transport, meters, plugin params) | `EngineStore`, `PluginParamsStore` (`@studio/engine-browser`) | the leaf that draws it |
| the shell's own state that panes need | the **shell store**, `src/state/shellStore.ts` (zustand) | each pane, through a selector |
| everything one component owns | `useState` in that component | that component |

## The shell store

**Panes read what every pane needs instead of being handed it.** The reload signal, the
read-only flag, the command runners, the right-click menu, the seek, and the one command line per
gesture (`state/paneCommands.ts`) were props threaded through App into every pane, often
through one or two components that only forwarded them. A pane now asks the store for them, and
App's JSX names what is particular to the call site and nothing else.

**One store per shell, held in context, read through selectors.** The context value is the store
object, which never changes, so putting it in context re-renders nobody. A pane subscribes to the
slice its selector returns and re-renders when that slice changes, and only then. The memoised
panes (`TimelineTab`, `ChainsTab`, `EditorTab`, `MasteringTab`) depend on that: one context
holding a value object rebuilt per App render would re-render every hidden pane on every caret
move. A selector must therefore return a primitive or an object the store itself holds, never one
built in the selector.

**The verbs are proxies, not values.** The store's `verbs` (`runCommand`, `setStatus`,
`quietCommand`, `openContextMenu`, `seek`, `setLoop`) are created once with the store and call the
host's current implementation through a ref. Their identity never changes, so a pane that depends
on one never re-runs an effect for it, and a pane that calls one from its first effect reaches the
real implementation rather than a placeholder: children commit before their parent, so a store
filled in by App's effect would still be empty then.

**A store is per HOST, not a module singleton.** The second device's timeline
(`components/ExternalTimeline.tsx`) mounts the same `TimelineTab` with a store of its own over its
own runner, offering a subset of the gestures; a gesture the host does not offer is a handle the
pane does not draw. Its reload key is the surface's `/revision`-driven one, which the store follows
rather than counts.

**The reload signal is store state.** `reload` (the counter plus the files a command wrote,
`reloadScope.ts`) lives in the store, with `bumpReload` and `reloadWith` beside it, so a pane that
writes a file directly asks for the reload itself.

**The frozen flag is read where it gates.** A snapshot takes away the editing gestures; the
pane that draws a handle decides from `frozen` whether to draw it, rather than App passing
`undefined` for each one.

## The overlay and toggle slices

**What is opened from many places and drawn in one lives in the store.** The right-click menu,
the module and asset pickers, the tap-chain and curve popins, the commands page, the assembly
builder and the undo confirm (`state/overlaySlice.ts`) are opened by commands, cards and graph
gestures, and drawn by `shell/ShellOverlays.tsx`, which reads them directly. The view toggles a
command flips and a pane reads — the right column, the help page, the graph's notes and stack
view, the lane curves, the rack builder, the History hover — are `state/toggleSlice.ts`. Their
setters take a value or an updater, like React's, so `ui/commands/` handlers keep their shape.

## What stays in App

**State that App derives from, or that drives App's own layout, stays local to App.** The page
and the bottom panel (`full`, `panel`) are mirrored in the URL by `useViewRoute`; the caret, the
timeline's view and the edit target feed the key conditions App builds; the editor popin and the
phone's palette are tied to refs and timers in App (the deferred prewrite, the dismiss timer).
Moving those would move App's logic into the store, not remove a prop.

**One-component state stays in the component.** A pane's own caret, zoom, selection and open
assemblies are its business; a store is for what crosses components.
