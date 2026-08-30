# The window

st0, loaded from this app's own origin — `docs/server.md` is why that origin exists and what it
buys. It opens at startup, because it is the app: there is no tray to open it from, and nothing
to be while it is closed.

It is a `BaseWindow` rather than a `BrowserWindow`, because it holds several views: a strip of
tabs and one project view each. `docs/tabs.md` is that page. `BaseWindow` has no
`ready-to-show`, so the frame carries a `backgroundColor` instead — the window paints in the
app's own colour rather than white while the strip loads.

## Closing it quits

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
