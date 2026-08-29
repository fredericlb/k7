# The window

st0, loaded from this app's own origin — `docs/server.md` is why that origin exists and what it
buys. This page is only about the window's lifetime, which has three rules that are each a bug
if you get them wrong.

## Closing is hiding

On every platform. The supervisor, the engine and the file service all outlive the window: the
app is still what it always was, a thing that runs with the machine and keeps an engine up for
whoever asks. Quit is the tray's Quit, or the app menu's.

So `close` is intercepted and turned into `hide()`, and `window-all-closed` is a no-op. On the
way out, `markQuitting()` runs **before** `preventDefault`, or the window's own handler would
swallow the quit and the app would refuse to die.

## `backgroundThrottling: false`

Not the default, and the default is wrong here. Chromium throttles timers in an occluded window
to roughly one a minute — so the transport's playhead and the meters would freeze the moment
the window went behind another, and st0's freeze watchdog would fill the console with stalls
that read as a render bug rather than as a policy.

## The Dock icon follows the WINDOW, not the app

`LSUIElement` and `app.dock.hide()` make this a menu-bar app with no Dock presence, which is
right when there is no window. But an open window with no Dock icon cannot be reached by
Cmd-Tab or by clicking anything — it exists and is unreachable once it goes behind something.

So `dock.show()` on `ready-to-show`, `dock.hide()` on close. And `activate` reopens: clicking
the Dock icon of a running app is expected to bring its window back rather than do nothing.

## Opening it

- **The tray menu's first row**, "Open studio". Enabled even with no engine running: the home
  page lists local projects, and opening one is how you get an engine in the first place.
- **A left-click on the tray icon**, on Windows and Linux, where that is the convention and the
  menu is the right-click. macOS has no such convention — there the menu *is* the click, so
  `setContextMenu` answers and the handler never fires.
- **Never on launch.** The app starts with the machine and lives in the menu bar; a window on
  every login would be the wrong default for something whose job is to keep an engine up.

A link that wants a new window opens in the user's **browser** instead
(`setWindowOpenHandler` → `shell.openExternal`). A chromeless window with no address bar is
the wrong place for anything you would want to check the URL of — and it is where an OIDC
sign-in must NOT happen (RFC 8252 §8.12).

## What is not here yet

The settings screens the plan describes — Engine, Audio, Plugins, Sessions, Web UIs, Server —
are not in the window. Every one of those controls already exists in the tray menu and works,
so building a second surface for them before the SERVER settings (lot C) exist would be
duplicating a working thing to no end. The snapshot that would feed them is already the same
`HostSnapshot` the menu draws from, and the `*Sig` fields it carries are what a React list
would need to key on — a 20 Hz playhead must not re-render a sessions table at frame rate.
