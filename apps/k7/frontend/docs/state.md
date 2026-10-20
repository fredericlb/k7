# Shell state: what lives in a store, what stays local

The shell holds four kinds of state, and each has one home.

| kind | home | read by |
|---|---|---|
| the engine's live state (transport, meters, plugin params) | `EngineStore`, `PluginParamsStore` (`@studio/engine-browser`) | the leaf that draws it |
| the shell's own state that panes need | the **shell store**, `src/state/shellStore.ts` (zustand) | each pane, through a selector |
| a document read from the file service (the graph, the compiled project) | the **query cache**, `src/queries/` (TanStack Query) | each pane, at a key |
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

## The query cache

**A document is read once per key, however many panes draw it.** The chains page, the bottom
panel, a lane's modules, the tap chain, the History panel, the clip view and App's own lookups
all asked `/graph` for themselves on every reload; the timeline, the minimap, the clip view and
the shell's projection each asked `/project-doc`. Each is now one query keyed by
`(scope, key)` (`queries/graph.ts`, `queries/projectDoc.ts`), and every reader of a key shares
its answer and its request.

**The key is what refetches, and nothing else does.** A reload key moving is a new key, so the
cache answers each key for good (`staleTime: Infinity`) and never refetches on focus, on
reconnect or on a timer: the shell already says when something changed, and a second trigger
would be a second request for the same thing. A key no one reads any more is dropped a minute
later. `networkMode` is `always`: the desktop app with no internet still reaches its own
loopback server, and the default holds every read while `navigator.onLine` is false.

**The scope is the counter the key counts.** The shell's reload key, a second device's own one
(`useSurfaceCommands`), and the `/revision` token the mastering strip and the device's timeline
follow are different counters, so their numbers are kept apart. A pane reads its host's scope
from the shell store.

**What a pane's key MEANS stays the pane's.** The chains pane freezes its key while hidden, so a
reload is remembered and asked for only when it is shown; App's own read of the graph moves only
when a reload could have moved the chains (`movedTheChains`), and otherwise stays on the key it
already has. Sharing the cache changes how often a key is asked, never which key a pane reads.

**A writing command's answer is put in the cache.** `runCommand` stores the graph the service
built for the key its reload is about to move to, and a bypass for the key in force, so the reads
that reload would cause are already answered (`shell.md`, "A graph only when one is on screen").

**A failing read keeps the last answer and retries.** Reload-keyed reads retry on the same
backoff the document reads always had (`hooks/useDocument.ts`), with the last good answer still
drawn and the failure shown beside it; the `/revision`-keyed ones read null on failure, as they
did. A read that wants to be FRESH at the moment of a gesture — the asset picker's file list, a
`ui` command looking a node up — still asks the service directly.

## What stays in App

**State that App derives from, or that drives App's own layout, stays local to App.** The page
and the bottom panel (`full`, `panel`) are mirrored in the URL by `useViewRoute`; the caret, the
timeline's view and the edit target feed the key conditions App builds; the editor popin and the
phone's palette are tied to refs and timers in App (the deferred prewrite, the dismiss timer).
Moving those would move App's logic into the store, not remove a prop.

**One-component state stays in the component.** A pane's own caret, zoom, selection and open
assemblies are its business; a store is for what crosses components.
