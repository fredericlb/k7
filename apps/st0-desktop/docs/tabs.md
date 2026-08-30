# Tabs in the title bar

The window holds a strip of tabs above one project view each, the way a browser does. One rule
underneath it, and everything here follows from it:

> **Only the tab in front holds a project.** Switching unloads the one leaving and loads the one
> arriving.

Tabs are therefore the answer to *several projects addressed*, and never to *one project on two
screens* — two tabs are never on screen at once. That second question has its own answer, a
window opened beside this one with no strip at all: `docs/window.md`.

That is not a limitation of the tab strip. It is `packages/engine-registry/docs/claim.md` rule 2
— one project per engine — left standing on purpose: the file service holds a single active
project per workspace, and a second one on the same machine does not coexist with the first, it
clobbers it. Tabs let you keep several projects *addressed*; they do not make the machine hold
two at once.

## A tab is a page, not a project inside a page

Each tab is its own `WebContentsView` loading its own address. That is the cheap way, and the
reason is in `packages/project-shell/docs/launch.md`: a project IS an address, and the router's
basename is what pins it. Two projects inside one page would mean two routers and two
`fileCfg`s — and `fileCfg` (`packages/project-shell/src/fileApi.ts`) is a module singleton. As
separate views, each tab gets its own router, its own file transport and its own engine socket,
and st0's frontend needed almost nothing.

`src/tabs.ts` is the whole model: the list, which one is in front, and the bounds. `src/window.ts`
owns the window, the strip and the layout.

## A tab is labelled by the page, and the page names the SONG

`TabStrip` draws `webContents.getTitle()`, so a tab says whatever the page put in
`document.title` — and st0 sets it to the song's own name, not the app's. Repeating "st0" on
every tab of an st0 window names the tool four times and the work never; `index.html`'s title is
what a page that sets none falls back to.

It is set **twice**, and the order is the point. `appMain.tsx` sets it off the ADDRESS at import
time, so the strip is right before anything has loaded and never shows the app name even for a
frame; `App` then refines it to the song's `name:` field, which is what `project.yaml` says and
what the header shows beside it. The settings tab names itself the same way.

## The home tab is fixed, and everything opens from it

The first tab is st0's home page — the account's repositories and the projects in them
(`apps/st0/frontend/docs/projects.md`) — and it is the only one opened by `openWindow`. It
draws as a house icon with no label, it has no close button, and `TabSet.close` refuses it as
well: the missing control is then a rule rather than an oversight, since it is where every
other tab comes from.

**Opening a project from it opens a tab beside it.** The home tab's view carries a
`will-navigate` handler, and st0 links a project with a plain `<a href>` and an absolute
address (`apps/st0/frontend/src/projects/RepoTree.tsx`) — a real navigation, not a router
push — so the main process sees it, cancels it, and opens the target as a new tab. **The page
needs no idea any of this exists**, which is why it is done here and not in st0: the hosted
build follows the same link in the same tab, and neither had to learn about the other.

Three outcomes, and the third is the one to be careful about:

| the home tab navigates to | what happens |
|---|---|
| home itself (a reload, a query) | allowed — that is not leaving |
| the same origin, another path | a new tab beside it |
| **another origin** | `shell.openExternal` |

That last row is not tidiness. A tab has no address bar, and an OIDC sign-in must not happen in
one (RFC 8252 §8.12) — it is the same rule `setWindowOpenHandler` follows for a new window, and
relaxing it here would reopen the hole that one closes.

A tab that holds a **project** wears a note on its left; the home tab is a house, and everything
else — `@settings`, `/external` — carries its title alone. So the strip says at a glance which of
its tabs is a song, which is the distinction that matters when three are open and two are chrome.
`isProjectAddress` is that question, in `@studio/web-protocol/projects` rather than here: the main
process asks it too, to know what a second window would open on (`docs/window.md`), and two copies
would drift.

There is no "+" button. With a pinned home tab it would only ever produce a second copy of the
home page, and the strip already has the affordance it would have been: the house.

## Sleeping a tab is the idle path, not a new one

A backgrounded tab does exactly what a tab left alone for twenty minutes does —
`packages/project-shell/docs/idle.md`, step for step: `children` unmounts, the engine hook
disposes its socket, `onIdle` gives the lease back, and `POST /engine/unload` stops, flushes and
drops the session. `ProjectGate` grew one prop, `asleep`, which puts it in the same `idle` phase
the timer does.

The phase records **why** it went to sleep, and that field is load-bearing. A tab that went
behind another wakes itself when it comes forward; a session the *timer* closed waits for a hand
on the button. Without the distinction, auto-waking would undo the whole of `idle.md`.

## Told, not inferred

The main process **sends** each view a message when it goes behind or comes forward
(`studio:tab`, through `src/preload.ts`), rather than letting the page read
`document.visibilityState`.

Two reasons, and the second is the one that decides:

1. Chromium's visibility for a *detached* `WebContentsView` is not something Electron documents,
   and `backgroundThrottling: false` — which every view sets, for the reason in `docs/window.md`
   — is in the same area.
2. **Order.** The page is told *before* it is hidden, so its unload leaves over a socket that is
   still up. A visibility change arrives after the fact, which is the same race
   `idle.md` avoids by putting the flush in an effect rather than in the timer's callback.

The preload is the only place the app reaches into a page, and it carries nothing else.

## The strip is a page in st0

`/@tabs`, a sentinel repository like `/@settings` (`packages/web-protocol/projects.ts`), loaded
in a view of its own above the tabs. Desktop chrome as a page on the app's own origin is the
shape `/@settings` already set — one build, one theme, no second toolchain for 36 pixels.

It is rendered **before** the account gate: the window's furniture has to be drawn while
whatever is below it is still deciding who is logged in.

`titleBarStyle: "hidden"` plus `titleBarOverlay` gives Chromium's own caption buttons at the
right-hand end on Windows and Linux; macOS uses `hiddenInset` and the strip insets itself for
the traffic lights, which is what the `?inset=` in its address is for. The bar drags the window
(`-webkit-app-region: drag`) and every control takes itself back out with `no-drag` — forget
that and the tabs render correctly and cannot be clicked.

Each view is re-told on every `did-finish-load`, not just when it changes. A page that reloaded
while hidden comes back with the preload's default — "I am in front" — and would take its
project back from behind another tab, silently, while the tab you are looking at holds it too.

## What it does not change

Closing the **window** still quits: the engine, the file service and the supervisor go with it
(`docs/lifetime.md`). Closing the last **tab** closes the window, which is the same thing said
from the other end.

## The one thing not verified headlessly

`app.on("window-all-closed")` in `src/main.ts` is what makes closing the window quit. Electron
documents it as "emitted when all windows have been closed" without saying whether a
`BaseWindow` counts, and this machine cannot run Electron to find out. **Check it on the first
run**: close the window and confirm the engine, the file service and the supervisor are gone. If
it does not fire, the fix is one `win.on("closed")` calling `app.quit()` — not a redesign.
