# A shot's speed — one signed number

```k7x
// video_tracks/main.k7x
events([
  ref("run").start(0).length(4).speed(0.5), // slow motion
  ref("crowd").start(4).length(2).speed(3), // fast
  ref("face").start(6).length(3).speed(0), // held on its first frame
  ref("glass").start(9).length(2).source_from(5).speed(-1), // backwards from 5 s
])
```

## One mapping, signed, for every case

The frame a shot shows at timeline time `t` is

> `source_from + (t − start) × speed`

so `2` spends two seconds of source per second of song, `0` holds `source_from`, and `−1` runs
backwards FROM `source_from`. Freeze and reverse are not separate fields. A `reverse: true` beside
`speed` would need its own rule in every edit, and the split and the head trim would each have to
ask which end of the window the shot starts from. Signed, the edits are one line each, with speed
as a factor:

- **a split's tail** starts `head × speed` further into the source than the shot did;
- **a head trim** moves `source_from` by `delta × speed`, so the frame under the edge stays. A
  reversed shot whose head moves later starts EARLIER in its source.

A reverse anchored on `source_from` is also what an editor reads: the shot starts on that frame,
whichever way it then runs.

## The length stays, the source spent changes

`speed` leaves `start` and `length` alone, so changing it never moves a cut and never pushes the
next shot along. What changes is how much source the shot spends: `length × |speed|`. Past the
source's end, or before its first frame when running backwards, the lane shows nothing, as it does
for any shot outrunning its material. A reverse that would reach the first frame before the shot
ends is refused on its line by the schema, and by `picture speed`.

`speed` needs a source, so an activation refuses it.

## What realtime can play, and what only export can

Export samples every frame at its exact source time, whatever the speed
([../../ui-eyes/docs/realtime.md](../../ui-eyes/docs/realtime.md)). The realtime preview plays a
`<video>`, which runs forwards at a positive rate and nothing else. So a freeze, a reverse, or a
rate outside the range a browser plays is shown by PARKING the element and seeking it as the
playhead moves: every frame is right, but a reverse previews choppier than it renders.

## The sound follows, resampled, and goes quiet where it cannot

A shot's sound ([../../song/docs/videoSound.md](../../song/docs/videoSound.md)) runs at the same
speed through a two-marker `varispeed` warp: resampled, so its pitch follows the speed as a tape's
would. The engine has no reverse playback, so a reversed shot is silent, and so is a freeze, which
has no sound to hold.
