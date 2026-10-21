// trayicon.rs — the menu-bar icon: the k7 cassette, scaled from the tray's own app icon, wearing a status badge drawn
// in code — four states, one of them animated, which would otherwise be an asset per state per frame. Described in a
// unit square and 3× oversampled. See docs/trayIcon.md.

use std::sync::OnceLock;
use tauri::image::Image;

const N: usize = 44; // 22pt @2x — the menu-bar size
const SS: usize = 3; // oversampling factor
const S: usize = N * SS;

type Rgba = [f32; 4]; // straight (non-premultiplied) alpha, 0..1

const GREEN: Rgba = [0.20, 0.78, 0.35, 1.0]; // running
const RED: Rgba = [1.00, 0.27, 0.23, 1.0]; //   stopped
const AMBER: Rgba = [1.00, 0.62, 0.04, 1.0]; //  can't start
const BLUE: Rgba = [0.04, 0.52, 1.00, 1.0]; //   loading

/// What the corner badge is saying — distinct from `EngineStatus`: "running but still scanning" is one status
/// and two different icons.
#[derive(Clone, Copy, PartialEq)]
pub enum IconState {
    Running,
    Stopped,
    Error,
    /// Spinner frame index — advances while the engine is up but not yet ready.
    Loading(usize),
}

struct Canvas {
    px: Vec<Rgba>,
}

impl Canvas {
    fn new() -> Self {
        Self {
            px: vec![[0.0; 4]; S * S],
        }
    }

    /// Composite `color` wherever `inside` is true; `inside` takes unit coordinates, so every shape is
    /// resolution-independent.
    fn fill(&mut self, color: Rgba, inside: impl Fn(f32, f32) -> bool) {
        for y in 0..S {
            let v = (y as f32 + 0.5) / S as f32;
            for x in 0..S {
                let u = (x as f32 + 0.5) / S as f32;
                if !inside(u, v) {
                    continue;
                }
                let dst = self.px[y * S + x];
                let a = color[3];
                let out_a = a + dst[3] * (1.0 - a);
                let mix = |c: usize| {
                    if out_a <= 0.0 {
                        0.0
                    } else {
                        (color[c] * a + dst[c] * dst[3] * (1.0 - a)) / out_a
                    }
                };
                self.px[y * S + x] = [mix(0), mix(1), mix(2), out_a];
            }
        }
    }

    /// Composite a `d`×`d` image over the canvas from its top-left corner.
    fn paint(&mut self, img: &[Rgba], d: usize) {
        for y in 0..d.min(S) {
            for x in 0..d.min(S) {
                let src = img[y * d + x];
                let dst = self.px[y * S + x];
                let a = src[3];
                let out_a = a + dst[3] * (1.0 - a);
                let mix = |c: usize| {
                    if out_a <= 0.0 {
                        0.0
                    } else {
                        (src[c] * a + dst[c] * dst[3] * (1.0 - a)) / out_a
                    }
                };
                self.px[y * S + x] = [mix(0), mix(1), mix(2), out_a];
            }
        }
    }

    /// Punch a hole (destination-out), clearing a gap so the badge reads as its own token, not part of the note head.
    fn erase(&mut self, inside: impl Fn(f32, f32) -> bool) {
        for y in 0..S {
            let v = (y as f32 + 0.5) / S as f32;
            for x in 0..S {
                let u = (x as f32 + 0.5) / S as f32;
                if inside(u, v) {
                    self.px[y * S + x] = [0.0; 4];
                }
            }
        }
    }

    /// Box-filter SS×SS blocks down. Averaging happens in PREMULTIPLIED space — straight alpha would drag the
    /// colour of fully transparent pixels into the edges and fringe the glyph.
    fn finish(&self) -> Image<'static> {
        let mut out = Vec::with_capacity(N * N * 4);
        for y in 0..N {
            for x in 0..N {
                let (mut r, mut g, mut b, mut a) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
                for dy in 0..SS {
                    for dx in 0..SS {
                        let p = self.px[(y * SS + dy) * S + (x * SS + dx)];
                        r += p[0] * p[3];
                        g += p[1] * p[3];
                        b += p[2] * p[3];
                        a += p[3];
                    }
                }
                let n = (SS * SS) as f32;
                let (r, g, b, a) = (r / n, g / n, b / n, a / n);
                let un = |c: f32| {
                    if a <= 0.0 {
                        0u8
                    } else {
                        ((c / a).clamp(0.0, 1.0) * 255.0).round() as u8
                    }
                };
                out.extend_from_slice(&[un(r), un(g), un(b), (a * 255.0).round() as u8]);
            }
        }
        Image::new_owned(out, N as u32, N as u32)
    }
}

fn rect(x0: f32, y0: f32, x1: f32, y1: f32) -> impl Fn(f32, f32) -> bool {
    move |u, v| u >= x0 && u <= x1 && v >= y0 && v <= y1
}

fn disc(cx: f32, cy: f32, r: f32) -> impl Fn(f32, f32) -> bool {
    move |u, v| (u - cx).powi(2) + (v - cy).powi(2) <= r * r
}

/// An arc of an annulus, `sweep` radians wide from `from` (clockwise, screen coordinates): the spinner's tail.
fn arc(cx: f32, cy: f32, r: f32, width: f32, from: f32, sweep: f32) -> impl Fn(f32, f32) -> bool {
    move |u, v| {
        let (dx, dy) = (u - cx, v - cy);
        let d = (dx * dx + dy * dy).sqrt();
        if d < r - width / 2.0 || d > r + width / 2.0 {
            return false;
        }
        let mut a = dy.atan2(dx) - from;
        let tau = std::f32::consts::TAU;
        a = a.rem_euclid(tau);
        a <= sweep
    }
}

/// Triangle by half-plane tests (points given clockwise).
fn tri(p: [(f32, f32); 3]) -> impl Fn(f32, f32) -> bool {
    move |u, v| {
        let side = |a: (f32, f32), b: (f32, f32)| (b.0 - a.0) * (v - a.1) - (b.1 - a.1) * (u - a.0);
        let (s0, s1, s2) = (side(p[0], p[1]), side(p[1], p[2]), side(p[2], p[0]));
        (s0 >= 0.0 && s1 >= 0.0 && s2 >= 0.0) || (s0 <= 0.0 && s1 <= 0.0 && s2 <= 0.0)
    }
}

/// Render the tray icon: the k7 cassette, and the status badge in its corner.
pub fn render(state: IconState) -> Image<'static> {
    render_with(state, false)
}

/// The cassette, the tray's own app icon (apps/k7/frontend/scripts/icons.mjs renders it), scaled once to the canvas.
static MARK: OnceLock<Vec<Rgba>> = OnceLock::new();
/// The square, from the top-left corner, the icon is drawn in: the badge's clear ring takes the cassette's corner.
const MARK_PX: usize = S * 22 / 25;

fn mark() -> &'static [Rgba] {
    MARK.get_or_init(|| {
        let img = Image::from_bytes(include_bytes!("../icons/icon.png")).expect("the tray's icon.png is a PNG");
        scale_down(img.rgba(), img.width() as usize, img.height() as usize, MARK_PX)
    })
}

/// Area-average an RGBA8 image to `d`×`d`, in premultiplied space like `finish`, so no edge is fringed.
fn scale_down(src: &[u8], w: usize, h: usize, d: usize) -> Vec<Rgba> {
    let mut out = vec![[0.0; 4]; d * d];
    for oy in 0..d {
        let (y0, y1) = (oy * h / d, ((oy + 1) * h / d).max(oy * h / d + 1));
        for ox in 0..d {
            let (x0, x1) = (ox * w / d, ((ox + 1) * w / d).max(ox * w / d + 1));
            let (mut r, mut g, mut b, mut a) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
            for y in y0..y1 {
                for x in x0..x1 {
                    let p = &src[(y * w + x) * 4..(y * w + x) * 4 + 4];
                    let pa = p[3] as f32 / 255.0;
                    r += p[0] as f32 / 255.0 * pa;
                    g += p[1] as f32 / 255.0 * pa;
                    b += p[2] as f32 / 255.0 * pa;
                    a += pa;
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as f32;
            let un = |c: f32| if a <= 0.0 { 0.0 } else { c / a };
            out[oy * d + ox] = [un(r), un(g), un(b), a / n];
        }
    }
    out
}

/// As `render`, plus an `attention` dot for something waiting in the menu — today, a web UI whose origin was
/// refused. It gets its OWN corner rather than replacing the status badge: the engine can be happily running
/// while a browser is locked out, and both must be readable at once. It exists at all because the notification
/// banner can't be relied on — macOS silently drops notifications from an unsigned bundle, and an icon we draw
/// ourselves needs nobody's permission.
pub fn render_with(state: IconState, attention: bool) -> Image<'static> {
    let mut c = Canvas::new();
    // The cassette in colour, which reads on a light menu bar and a dark one alike, so no appearance is asked.
    c.paint(mark(), MARK_PX);

    // --- the badge, bottom-right, with a cleared ring so it never merges with the mark.
    let (bx, by, br) = (0.82, 0.82, 0.17);
    c.erase(disc(bx, by, br * 1.22));
    match state {
        IconState::Running => c.fill(GREEN, disc(bx, by, br)),
        IconState::Stopped => c.fill(RED, disc(bx, by, br)),
        IconState::Error => {
            // A warning triangle, not a dot: "can't start" is a different KIND of thing from "off", and shape carries
            // that without relying on the user telling red from amber.
            let (t, h) = (br * 1.15, br * 0.95);
            c.fill(
                AMBER,
                tri([
                    (bx, by - h),
                    (bx + t, by + h * 0.85),
                    (bx - t, by + h * 0.85),
                ]),
            );
            let stroke: Rgba = [0.12, 0.10, 0.02, 1.0];
            c.fill(stroke, rect(bx - 0.022, by - h * 0.30, bx + 0.022, by + h * 0.30));
            c.fill(stroke, disc(bx, by + h * 0.58, 0.030));
        }
        IconState::Loading(frame) => {
            // A ¾ arc spun by frame index — the same tick that animates the "Plugins" line, so the two can't disagree.
            let step = std::f32::consts::TAU / 10.0;
            let from = (frame as f32) * step;
            c.fill(
                BLUE,
                arc(bx, by, br * 0.78, br * 0.52, from, std::f32::consts::TAU * 0.72),
            );
        }
    }

    if attention {
        let (ax, ay, ar) = (0.86, 0.14, 0.13);
        c.erase(disc(ax, ay, ar * 1.35));
        c.fill(AMBER, disc(ax, ay, ar));
    }
    c.finish()
}

// A developer aid, not a real test: renders every state to /tmp, a 22pt icon being too small to judge in place.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dump_icons() {
        let dir = std::path::Path::new(env!("STUDIO_ICON_DUMP_DIR"));
        std::fs::create_dir_all(dir).unwrap();
        let states = [
            ("running", IconState::Running),
            ("stopped", IconState::Stopped),
            ("error", IconState::Error),
            ("loading0", IconState::Loading(0)),
            ("loading3", IconState::Loading(3)),
            ("loading6", IconState::Loading(6)),
        ];
        {
            for (name, st) in states {
                let img = render(st);
                let (w, h) = (img.width(), img.height());
                let buf: image::RgbaImage =
                    image::ImageBuffer::from_raw(w, h, img.rgba().to_vec()).unwrap();
                // 8× nearest-neighbour so the shapes are legible on screen.
                let big = image::imageops::resize(
                    &buf, w * 8, h * 8,
                    image::imageops::FilterType::Nearest,
                );
                let tag = "k7";
                big.save(dir.join(format!("{tag}-{name}.png"))).unwrap();
                buf.save(dir.join(format!("{tag}-{name}-1x.png"))).unwrap();
                // ...and the same state wearing the attention dot.
                let a = render_with(st, true);
                let abuf: image::RgbaImage =
                    image::ImageBuffer::from_raw(w, h, a.rgba().to_vec()).unwrap();
                image::imageops::resize(&abuf, w * 8, h * 8, image::imageops::FilterType::Nearest)
                    .save(dir.join(format!("{tag}-{name}-attn.png")))
                    .unwrap();
            }
        }
    }

    #[test]
    fn render_is_cheap_enough_to_animate() {
        let t = std::time::Instant::now();
        for i in 0..60 {
            std::hint::black_box(render(IconState::Loading(i)));
        }
        let per = t.elapsed().as_secs_f64() / 60.0 * 1000.0;
        println!("render: {per:.2} ms/frame (debug build)");
        // The spinner ticks every 120ms; a frame must cost a small fraction of that.
        assert!(per < 30.0, "icon render too slow to animate: {per:.2} ms");
    }
}
