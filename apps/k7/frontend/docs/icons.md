# The app icon

k7's icon is ONE drawing, `apps/k7/frontend/icon/k7.svg` — a cassette — and every platform's
icon is a render of it by `apps/k7/frontend/scripts/icons.mjs`. Nobody edits a PNG by hand: change
the SVG, run `node apps/k7/frontend/scripts/icons.mjs`, commit what it wrote. The startup splash
below is drawn the same way.

## Where each platform reads it

| platform | file | shape |
|---|---|---|
| web, PWA (`public/manifest*.webmanifest`) | `public/icon-192.png`, `public/icon-512.png` | the cassette on a rounded black tile |
| PWA, maskable | `public/icon-*-maskable.png` | #07031F to the edges, the cassette inside the 80% circle a mask keeps |
| browser tab | `public/favicon.ico` (16, 32, 48) | the cassette alone, as large as it fits |
| iPhone home screen (web) | `public/apple-touch-icon.png` | #07031F to the edges: iOS rounds it |
| the tray's installer and app bundle | `apps/k7-tray/src-tauri/icons/`; its menu-bar glyph is drawn in code (`apps/k7-tray/docs/trayIcon.md`) | the cassette alone, on transparency |
| Android | `engine/k7-android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` | the cassette alone, inside the 72dp circle; `ic_launcher.xml` paints the #07031F (`res/values/colors.xml`) |
| iOS | `engine/k7-ios/k7/Assets.xcassets/AppIcon.appiconset/icon-1024.png` | #07031F to the edges: iOS masks it |
| a plugin's window, opened by the engine | `engine/k7-runtime/engine/resources/studio_icon.png` | the cassette alone, on transparency (`public/icon-desktop.png`'s drawing) |

## The startup splash

Every app starts on ONE other drawing, `apps/k7/frontend/icon/k7-splash.svg` — the cassette, full
size — centred on **#07031F**, and the same script renders it for the platforms that cannot read an
SVG. That colour is painted by every layer that can show before the page does, so nothing between
the system's launch screen and k7's first render flashes another colour.

| app | where it shows | what it reads |
|---|---|---|
| web, PWA | `index.html`'s `#k7-splash`, over the startup waits until the first screen; an installed PWA's launch screen | the SVG itself; `background_color` in both manifests |
| `k7.rocks`, `www.k7.rocks` | the whole page, with "Coming soon" (`apps/k7/backend/docs/site.md`) | `icon/k7-splash.inline.json`, the SVG inlined and bundled into the backend, so the page fetches nothing |
| Android | the window's background (`res/drawable/splash.xml`, `AppTheme.Launch`), then the shell page while the phone's k7 starts (`engine/k7-android/web/src/Backend.tsx`) | `res/drawable-nodpi/splash_art.png`; the SVG in the shell page |
| iOS | `UILaunchScreen` (`Info.plist`), then the same shell page | `Assets.xcassets/Splash.imageset`, on `LaunchBackground` |

- **The web splash says what it waits for**: "Loading k7…" and the count of files received so far,
  from a few lines inlined in `index.html` that run before any of k7's code. A silent cassette through
  the longest wait a start has — the dev server sends the app as hundreds of separate modules — reads
  as a hang. The language is the one the app stored
  (`PARAGLIDE_LOCALE`), since paraglide itself has not loaded yet; from the first render on, the gates
  write each step there themselves ("Checking your sign-in…", "Opening the project…").
- **It stays until the first screen, not the first render.** The gates' waits have nothing behind
  them, and a black window with a line at its foot between the cassette and the page reads as a
  crash. So the splash sits beside `#root`, where React's render leaves it, and every `GateWait`
  holds it (`packages/project-shell/docs/launch.md`).
- **Only the start draws it.** Once the first screen is up, a wait inside the running app is the bar
  at the bottom, and the lazy screens' `Booting` never brings the cassette back.
- **Android 12 and later draw their own splash first**, the launcher icon on a colour: that colour
  is #07031F as well (`res/values-v31/themes.xml`), and the cassette follows it.

## Choices

- **Nothing behind the cassette on a computer.** A dock and a taskbar draw an icon as its shape, and
  the cassette is a shape of its own; a tile would put a dark square on every light dock.
- **#07031F behind it on a phone.** A launcher masks every icon to its own shape, so something has
  to fill the mask: the splash's colour, so the icon and the app it opens are one colour.
- **The web's own tile stays black**, `icon-192.png` and `icon-512.png`: a browser draws it on a
  page or a tab bar of any colour, where a tile keeps the light-edged drawing readable.
- **The favicon has no tile.** At 16 pixels a tile eats a quarter of the width the cassette needs.
- **Rendered by Chrome through Playwright**, already a dependency of the repository, rather than
  a rasterizer added for one script. It uses Playwright's own Chromium when installed, the
  machine's Chrome otherwise.
