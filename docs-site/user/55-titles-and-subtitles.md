# Titles, shapes and subtitles

k7 draws three kinds of graphics without any footage: **shapes** (boxes and dots), **titles**
(blocks of text), and **subtitles** read from `.srt` or `.vtt` files.

## Shapes and titles

A shape is a **module** in the `shapes` category. It is a picture source, like a camera: wire it to
a picture lane and that lane draws it. Its position and size are `params`, in viewport pixels.

| `shape` | params | fields |
|---|---|---|
| `square` | `x`, `y` (top-left), `w`, `h` | `color` |
| `circle` | `x`, `y` (the centre), `r` | `color` |
| `text` | `x`, `y` (top-left), `font_size` (px, default 24), `w`, `line_height`, `padding` | `content`, `font`, `color`, `align`, `background`, `shadow` |

`color` is any CSS colour, alpha included (`"#e2b53acc"`); white when left out.

```js
// _modules/shapes/box/module.k7x
type("shape")
shape("square")
color("#e2b53acc")
params({ x: 448, y: 220, w: 384, h: 280 })
```

```js
// _modules/shapes/title/module.k7x
type("shape")
shape("text")
content("k7")
font("sans-serif")
color("#ffffff")
params({ x: 40, y: 560, font_size: 72 })
```

### Setting text

A `text` shape is set as a block:

| field or param | effect |
|---|---|
| `content` | the words; line breaks you write are kept |
| `font` | a CSS font family (`sans-serif` by default) |
| `w` (param) | the width the lines wrap in; a single word wider than it is condensed to fit. Without `w`, lines are not wrapped |
| `align` | `left` (default), `center` or `right` — inside `w`, or about `x` when there is no `w` |
| `line_height` (param) | a multiple of the font size; 1.2 when left out |
| `background` | a box behind the lines, any CSS colour; the box hugs the lines actually drawn |
| `padding` (param) | pixels between the lines and their box (30% of the font size by default) |
| `shadow` | `true` puts a soft shadow under the glyphs, for text over a busy picture |

```js
type("shape")
shape("text")
content("Live at the Studio\nOctober 2026")
align("right")
background("#000000aa")
params({ x: 680, y: 40, w: 560, font_size: 48, padding: 16 })
```

### Putting a shape on screen

Give each shape a lane of its own, so it can be hidden on its own and take its own effects. In the
lane's chain the shape comes first, then the lane:

```js
// chains/title_layer.k7x
start(true)
steps([
  id("title").extends("@workspace/shapes/title"),
  id("title-lane").video_track("title_layer"),
])
```

A lane of shapes has no rectangle of its own: it covers the whole frame and each shape carries its
geometry. A shape wired to no picture lane draws nothing, and the picture's warnings say so.

### When a shape shows: activations

On a lane of shapes, an event with no `ref` is an **activation**: it says *when* the shapes are on
screen. A lane with no events draws its shapes throughout.

```js
// video_tracks/title_layer.k7x — the title is on from 4 s to 8 s
events([start(4).length(4)])
```

An activation takes `start`, `length` (0 runs to the next activation) and `animate`; it has no
source, so `source_from`, `speed`, `effect`, `fade_in` and `fade_out` are refused on it.
Activations are dragged on the timeline like shots and show as **on**.

A lane that has shapes wired to it draws only its shapes: a shot placed on it would never be seen,
and the picture's warnings say so.

## Subtitles

A subtitle file is a **clip**. Put an `.srt` or WebVTT `.vtt` file in `clips/` (dropping it on a
picture lane does that for you), and place it on a picture lane like a shot. Its cues keep their
times relative to the file's start, so moving the shot moves every cue, and `source_from` and
`length` trim the file as they trim a video.

```js
// clips/subs-en.k7x
source("clips/subs-en.srt")
font_size(40)
background("#000000b0")
position("bottom")
```

```js
// video_tracks/captions.k7x
events([ref("subs-en").start(0)])
```

How the cues are set, every field optional:

| field | meaning | default |
|---|---|---|
| `font` | a CSS font family | `sans-serif` |
| `font_size` | pixels of the viewport | 5% of the frame's height |
| `color` | text colour | white |
| `background` | a box behind each cue, any CSS colour | none — the text gets a shadow instead |
| `align` | `left`, `center`, `right` | `center` |
| `position` | `bottom`, `top` or `middle` | `bottom` |
| `margin` | pixels from that edge | 6% of the frame's height |

Each cue wraps within 80% of the frame's width, centred. Markup inside cues (`<i>`, `<b>`, voice
tags) is removed, and WebVTT header, `NOTE`, `STYLE` and `REGION` blocks are skipped. A block that
cannot be read (no timing line, an unreadable time, an end before its start) is named in the
picture's warnings and left out; the rest still show. Nothing is drawn between cues.

Subtitles are not part of a cut handed to another editor (see
[Exchanging cuts](./58-exchanging-cuts.md)); they are part of every rendered video.
