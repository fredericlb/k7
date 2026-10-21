# The tray icon is drawn, not loaded

`src-tauri/src/trayicon.rs` rasterizes the menu-bar icon in code rather than shipping PNGs.

The icon has to say four different things (running, stopped, can't start, loading), the
loading one has to **animate**, and on macOS the glyph has to flip dark-on-light for a
light menu bar. That is one shipped asset per state, per frame, per appearance — so it is a
generator, not an asset set. The whole icon is about fifteen rectangles, circles and arcs,
which is far less code than the pipeline that would bake them all.

The glyph is the app icon's mark (three bars and a note) re-traced as plain geometry. It is
deliberately **not** the 512px app icon downscaled: that art's long shadow and soft edges
turn to mush at 22pt, and the badge needs the bottom-right corner cleared.

Everything is described in a 0..1 unit square, rasterized 3× oversampled and box-filtered
down — which is where the antialiasing comes from.

The pixels leave as RGBA handed straight to Tauri's tray icon — no image library for one 44-pixel
square — at 2×, the menu bar's 22pt.
