# The app icon

k7's icon is ONE drawing, `apps/k7/frontend/icon/k7.svg` — a cassette — and every platform's
icon is a render of it by `apps/k7/frontend/scripts/icons.mjs`. Nobody edits a PNG by hand: change
the SVG, run `node apps/k7/frontend/scripts/icons.mjs`, commit what it wrote.

## Where each platform reads it

| platform | file | shape |
|---|---|---|
| web, PWA (`public/manifest*.webmanifest`) | `public/icon-192.png`, `public/icon-512.png` | the cassette on a rounded black tile |
| PWA, maskable | `public/icon-*-maskable.png` | black to the edges, the cassette inside the 80% circle a mask keeps |
| browser tab | `public/favicon.ico` (16, 32, 48) | the cassette alone, as large as it fits |
| iPhone home screen (web) | `public/apple-touch-icon.png` | black to the edges: iOS rounds it |
| desktop app (`apps/k7-standalone`) | `public/icon-512.png`, through `electron-builder.cjs` and `src/paths.ts` | the tile |
| Android | `engine/k7-android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` | the cassette alone, inside the 72dp circle; `ic_launcher.xml` paints the black |
| iOS | `engine/k7-ios/k7/Assets.xcassets/AppIcon.appiconset/icon-1024.png` | black to the edges: iOS masks it |
| a plugin's window, opened by the engine | `engine/k7-runtime/engine/resources/studio_icon.png` | the tile |

## Choices

- **Black behind the cassette.** The drawing is light-edged lavender, and it is drawn on black
  everywhere a platform shows a background, so it reads the same on a dock, a launcher and a tab.
- **The favicon has no tile.** At 16 pixels a tile eats a quarter of the width the cassette needs.
- **Rendered by Chrome through Playwright**, already a dependency of the repository, rather than
  a rasterizer added for one script. It uses Playwright's own Chromium when installed, the
  machine's Chrome otherwise.
