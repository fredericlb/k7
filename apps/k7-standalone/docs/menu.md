# The menu, and the release it names

## An explicit menu

The app installs its own application menu (`src/menu.ts`, the template in `src/menuTemplate.ts`,
tested in `src/menuTemplate.test.ts`). Electron's default menu is not one to ship: it reloads a page
(dropping what it holds unsaved), opens the inspector, and its About names package.json's version,
which no build moves.

| menu | holds |
|---|---|
| k7 (macOS only) | About, Check for Updates…, the automatic check's checkbox, Settings… (Cmd+,), Services, Hide, Quit |
| File | Close Tab (Cmd/Ctrl+W), Close Window (Shift+Cmd/Ctrl+W); elsewhere than macOS also Settings (Ctrl+,) and Quit |
| Edit | undo, redo, cut, copy, paste, delete, select all |
| View | zoom, full screen; Reload and the inspector only in a checkout run (`!app.isPackaged`) |
| Window | minimize; zoom and bring to front on macOS |
| Help | k7's documentation, the log folder; elsewhere than macOS also the update check and About |

**The window is a `BaseWindow` of views**, not a `BrowserWindow`, so it has no `webContents` of its
own. Menu roles that act on `window.webContents` — zoom, reload, the inspector — would find nothing,
so those items are clicks that act on the focused page (`webContents.getFocusedWebContents()`).
On macOS the Edit items keep their roles: those go down the responder chain, which reaches the
focused view, and a text field needs them there. Elsewhere they are clicks on the focused page too.
Delete carries no key: a page's own Delete — a clip, a node — must not become a text delete.

**Settings and the documentation are k7's own pages**, `/settings` and `/docs`, so the menu
navigates the tab set the way a link would (`TabSet.navigate`): both are home pages, which land in
the home tab, brought forward (`docs/tabs.md`).

**Cmd/Ctrl+W closes the tab, never the window.** The window closing quits the app, and a
keypress meant for one project must not end every one. Close Window is Shift+Cmd/Ctrl+W. The home
tab cannot be closed (`docs/tabs.md`), so on it Cmd+W does nothing.

On Windows and Linux the window frame is hidden (`docs/tabs.md`), so the menu bar is not drawn; its
accelerators are what remains of it.

## The release stamp

A build's identity is its **release stamp** — `vX.Y.Z` for a tag, `snapshot-<commit>` for a push to
`main` — the same string that names its files (`docs/desktop-release.md` at the root). The version
(`docs/versioning.md` at the root) does not move with a build, so the app shows the stamp.

`scripts/build-main.mjs` inlines `$STUDIO_RELEASE_STAMP` into the main process and the preload as
`__K7_RELEASE__` (`src/release.ts`); anything but the two CI shapes becomes `dev`, since the stamp is
shown to the person and compared with the builds k7.rocks/app_downloads serves. Both CI paths set the variable before packaging.
`electron-builder.cjs` sets the bundle's version (`extraMetadata.version`) from the root
package.json, so the OS's own views of the app agree with the release: `0.1.0` for the tag `v0.1.0`,
which it refuses to package under any other version, and `0.1.0-snapshot-9f2c1ab` for a snapshot, a
prerelease of the version it was cut from.

The stamp is shown in **About** (`app.setAboutPanelOptions`) and on k7's **settings page**, which
reads it from the preload's `window.studioApp.version`.
