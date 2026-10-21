# The tray icon: the k7 cassette, and a badge drawn in code

`src-tauri/src/trayicon.rs` builds the menu-bar icon from two parts: the k7 cassette, and a status badge
in its bottom-right corner.

| choice | why |
|---|---|
| the cassette is the tray's own app icon (`src-tauri/icons/icon.png`), embedded and scaled down once | one drawing of k7, rendered from `icon/k7.svg` by `apps/k7/frontend/scripts/icons.mjs`; the menu bar shows the same mark as the installer and the PWA |
| in colour, not a template image | macOS would turn a template monochrome, badge and all; the cassette's own colours read on a light menu bar and a dark one, so the icon asks no appearance |
| the badge drawn in code | it says four things (running, stopped, can't start, loading) and the loading one animates: an asset per state per frame, where the code is a few circles, a triangle and an arc |
| a cleared ring around the badge | it reads as its own token rather than part of the cassette, whose corner it takes |

Everything is composed on a 3× oversampled canvas and box-filtered down in premultiplied alpha, which is
where the antialiasing comes from, and leaves as RGBA handed straight to Tauri's tray icon at 2×, the
menu bar's 22pt. `cargo test dump_icons` writes every state to a folder, a 22pt icon being too small to
judge in place.
