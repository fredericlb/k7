# Tabs in the title bar

The window holds a strip of tabs above one page each, the way a browser does. The first tab is
k7's home page, drawn as a house; every project opens in a tab of its own beside it. One rule
underneath:

> **Only the tab in front holds a project.** Switching tells the leaving page to let its project
> go, and the arriving one to take its own back.

Tabs keep several projects *addressed*; they do not make the machine hold two at once. The file
service holds one active project per workspace and the registry one project per engine
(`packages/engine-registry/docs/claim.md`), so a second project held at the same time would not
coexist with the first, it would clobber it.

## A tab is a page

Each tab is its own `WebContentsView` loading its own address (`src/tabs.ts`). A project IS an
address, and the router's basename is what pins it (`packages/project-shell/docs/launch.md`); two
projects inside one page would mean two routers and two file transports, and the transport is a
module singleton. As separate views each tab has its own router, transport and engine socket, and
k7's frontend needs nothing beyond being told whether it is in front.

A tab is labelled by `document.title`, which k7 sets to the song's name.

## Where a navigation lands

The page needs no idea any of this exists: k7 links a project with a plain `<a href>`, a real
navigation the main process sees, cancels, and turns into a tab. The hosted build follows the same
link in the same tab. `src/routing.ts` is the whole table, tested in `src/routing.test.ts`:

| a tab navigates to | what happens |
|---|---|
| another origin | the system browser |
| `/auth/login` | the system browser, through the sign-in (`docs/signIn.md`) |
| the rest of `/auth/…`, `/api/…`, `/rtc` | in place — the local user and a handoff finish in the tab that started them |
| the home page or one of its own pages | the home tab, brought forward |
| a project | that project's tab, opened if no tab holds it |
| a project's `@external` surface | a tab of its own by a link, a window of its own by `window.open` |

A server REDIRECT to another origin is caught too (`will-redirect`), since it never passes
`will-navigate`. Another origin goes to the browser because a tab has no address bar, and a sign-in must not happen
in one (RFC 8252 §8.12). "The browser" means `openExternalSafely`
(`commons/packages/electron-shell/docs/shell.md`): only an `http:`, `https:` or `mailto:` URL
leaves, and any other scheme a page links to is dropped. A window a page opened — an `@external`
surface — is held to the same table: it keeps surfaces and the server's paths, and a link to the
home page, a project or another origin goes where it would from a tab. A project is keyed by its address up to the project folder, so a second
link to a project, or a different view of it, selects the tab that holds it.

The home tab has no close button, and `TabSet.close` refuses it as well: it is where every other
tab comes from. There is no "+" for the same reason.

**Cmd/Ctrl+W closes the tab in front, and Ctrl+Tab cycles.** Cmd/Ctrl+W is the menu's Close Tab
(`docs/menu.md`), and a tab also takes it in `before-input-event`, before the menu, so one keypress
closes one tab. Closing the window quits, so Close Window is Shift+Cmd/Ctrl+W.

## Told, not inferred

The main process **sends** each view `studio:tab` when it goes behind or comes forward, through
`src/preload.ts`, rather than letting the page read `document.visibilityState`. Chromium's
visibility for a hidden `WebContentsView` is not documented, and the order matters: the page is
told *before* it is hidden, so its unload leaves over a socket that is still up. A backgrounded
tab then does what a tab left alone does (`packages/project-shell/docs/idle.md`), through
`ProjectGate`'s `asleep`.

Each view is re-told on every `did-finish-load`: a page reloaded while hidden comes back with the
preload's default, "I am in front", and would take its project back from behind another tab.

Every tab sets `backgroundThrottling: false`: a throttled renderer stops the playhead.

## The strip is a page in k7

`/@tabs`, a sentinel repository (`packages/web-protocol/projects.ts`), loaded in a view of its own
above the tabs (`apps/k7/frontend/src/tabs/`). Desktop chrome as a page on the app's own origin
is one build and one theme, with no second toolchain for 36 pixels. It renders before the account
gate: the window's furniture is drawn while the page below is still signing in.

The window frame is hidden on every platform (`src/window.ts`). macOS keeps its traffic lights on
the strip; Windows and Linux get Chromium's caption buttons through `titleBarOverlay`, the same
height as the strip. The page is the same build everywhere, so the room each takes rides in its
address: `?inset=` on the left, `?right=` on the right. The bar drags the window
(`-webkit-app-region: drag`) and every control takes itself back out with `no-drag` — forget that
and the tabs render and cannot be clicked.

**Fullscreen on macOS is the simple kind** (`simpleFullscreen`). Native fullscreen keeps a window
below the camera housing of a notched screen and paints the band above it black, so the strip would
sit under a black border rather than at the top; simple fullscreen covers the whole screen, the strip
at its top edge, in the same Space. Fullscreen hides the traffic lights either way, and the window
tells the strip (`studio:fullscreen`, re-told on every resize, since simple fullscreen is one) so the
room kept for them goes too.

The strip holds the tabs and nothing else: the account is chosen on the home page, where its
workspaces are listed (`docs/signIn.md`), and a project's header shows no way home and no name in a
tab, the strip being both.

Only the strip may drive the tabs: every tab carries the same preload, so the main process drops a
`studio:tabs:*` message from any other sender.
