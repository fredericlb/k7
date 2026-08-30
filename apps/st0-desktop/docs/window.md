# The window, and the one that opens beside it

st0, loaded from this app's own origin — `docs/server.md` is why that origin exists and what it
buys. It opens at startup, because it is the app: there is no tray to open it from, and nothing
to be while it is closed.

It is a `BaseWindow` rather than a `BrowserWindow`, because it holds several views: a strip of
tabs and one project view each. `docs/tabs.md` is that page. `BaseWindow` has no
`ready-to-show`, so the frame carries a `backgroundColor` instead — the window paints in the
app's own colour rather than white while the strip loads.

## A second window, for a second screen

`openSecondWindow` opens a plain `BrowserWindow` on the **same project** the main window holds.
It is what a dual-screen setup needs and tabs cannot be: only the tab in front holds a project
(`docs/tabs.md`), and two tabs are never on screen at once anyway.

**It displaces nothing, and that is not luck.** Same account, same engine, same project is ONE
session with two screens, and `@studio/engine-registry/docs/claim.md` rule 1 exempts exactly
that case by name — the same exemption an external surface has always relied on. Without it the
second window would throw the first out of its own song.

Three things make it a different animal from the main window, and each is deliberate:

- **No strip and no tabs.** It shows one project and cannot leave it. So it is a `BrowserWindow`
  rather than a `BaseWindow`: one page, one view, and `ready-to-show` back — which is why it
  needs no `backgroundColor` trick of its own, though it carries one anyway.
- **A normal frame.** The main window hides its title bar because the strip IS the title bar;
  there is no strip here, so hiding it would leave nothing to drag onto the other display.
- **It is told it is in front, once.** A tab learns this from the strip; nothing will ever tell
  this window otherwise, and `preload.ts` already defaults to `active: true`. It is sent anyway
  on `did-finish-load`, so the state is asserted rather than inherited — see the note in
  `docs/tabs.md` about a page that is told rather than inferring.

**Which project it opens on is read here, not sent by the page.** The settings screen is itself
a tab, so the page asking has no idea which project is open; `TabSet` remembers the last project
address brought to the front (`projectUrl()`), and home, `@settings`, `@tabs` and `/external`
are not projects and leave the previous answer standing.

## Closing it quits — the MAIN one

Closing the main window closes every window opened beside it first. Without that,
`window-all-closed` never fires while a second window is up, and closing the main window would
stop quitting the app — silently, with the engine still running. Closing a second window closes
that window and nothing else.

`window-all-closed` calls `app.quit()`. `docs/lifetime.md` has the teardown order and the two
consequences (a second device and a hosted browser both lose the engine).

`activate` reopens rather than starting a second copy, because macOS keeps an app alive with no
windows, and a second launch raises the first window through `second-instance` — the
single-instance lock is keyed on the bundle identifier, so a second copy could never have had
its own engine anyway.

## `backgroundThrottling: false`

Not the default, and the default is wrong here. Chromium throttles timers in an occluded window
to roughly one a minute, so the transport's playhead and the meters would freeze the moment the
window went behind another — and st0's freeze watchdog would fill the console with stalls that
read as a render bug rather than as a policy.

It is set per **view**, not once on the window, and a tab behind another is exactly the case it
exists for.

## Links go to the browser

`setWindowOpenHandler` is set on every tab's view, and sends anything wanting a new window to
`shell.openExternal`. A chromeless
window with no address bar is the wrong place for anything you would want to check the URL of,
and it is where an OIDC sign-in must NOT happen (RFC 8252 §8.12) — which is exactly what the
pairing flow does.

## The settings are a page

Not a menu, and not a second window: `/@settings` in st0, offered only where the desktop app
serves it. See `docs/settings.md`.
