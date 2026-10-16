# Speed and animation

Two fields change how a shot plays without changing where it sits on the timeline: `speed`
retimes its source, `animate` moves it inside its lane's frame.

## Speed

`speed` is one signed number: how fast the source runs under the shot.

| value | effect |
|---|---|
| absent or `1` | the source's own pace |
| `2` | double speed |
| `0.5` | slow motion |
| `0` | a freeze on the frame at `source_from` |
| `-1` | backwards from `source_from` |

The shot keeps its place and its length on the timeline; what changes is how much source it
spends. A shot of 4 seconds at speed 2 plays 8 seconds of its source.

```text
picture speed main 4 0.5     # the shot starting at 4 s plays at half speed
picture speed main 4 1       # back to normal (the key is removed from the file)
```

```js
events([ref("run").start(4).length(3).source_from(10).speed(-1)])
```

A backwards shot runs out of source after `source_from / |speed|` seconds. A shot whose length is
longer than that is refused with a message saying how long it may be: shorten it, or start it
later in its source.

Speed is carried everywhere the shot goes: the shot's sound (`picture sound`) is retimed with it,
`picture head` and `picture split` move the in-point at the shot's speed, and a cut exported for
another editor carries the speed as a time warp (a freeze as a freeze frame).

## Animation

`animate` moves a shot inside its lane's rectangle. Five properties can be animated:

| property | unit | at rest |
|---|---|---|
| `x` | pixels of horizontal offset | `0` |
| `y` | pixels of vertical offset | `0` |
| `scale` | a factor, about the rectangle's centre | `1` |
| `opacity` | `0` (invisible) to `1` | `1` |
| `rotate` | degrees | `0` |

The lane's rectangle crops the shot whatever it does, and the shot looks the same mid-dissolve as
on either side of one.

Each property is either a constant or a list of **keys**. A key is `[t, v]` (time, value) or
`{ t, v, ease }` when the ease matters. Times are seconds **from the shot's own start**, so the
animation travels with the shot when you move or split it.

```js
events([
  ref("city")
    .start(10)
    .length(6)
    .animate({
      scale: [[0, 1], [6, 1.2]],                       // a slow push in
      opacity: [{ t: 0, v: 0, ease: "out" }, [1, 1]],  // fade up over the first second
      rotate: 0,
    }),
])
```

Before the first key a property holds the first key's value; after the last key it holds the
last value.

### Eases

A key's `ease` shapes the segment that **leaves** it, toward the next key:

| ease | movement |
|---|---|
| `linear` (default) | constant speed |
| `in` | starts slow, ends fast |
| `out` | starts fast, ends slow |
| `inout` | slow at both ends |
| `hold` | stays on this value, then jumps at the next key |

### Keys from the command bar

`picture key` sets one key, at a **timeline** time — so you can set it where the playhead is. k7
converts it to the shot's own time when it writes the file.

```text
picture key main 10 scale 16 1.2 inout   # on the shot starting at 10 s: scale 1.2 at 16 s
picture key main 10 opacity 10 0         # transparent at the shot's start
picture unkey main 10 scale 16           # remove that key
```

The arguments are the lane, where the shot starts, the property, the key's timeline time, the
value, and an optional ease. Setting a key at a time that already has one replaces it.
