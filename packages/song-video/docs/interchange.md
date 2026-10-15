# Handing the cut to another editor — OTIO and EDL

`picture interchange otio` writes every picture lane as an OpenTimelineIO timeline;
`picture interchange edl [lane]` writes one lane as a CMX 3600 EDL. Both land in the project's
`exports/cut.<ext>` (`packages/commands/src/verbs/pictureInterchange.ts`), and
`project export timeline` downloads the file. The writers are `src/interchange/`.

## OpenTimelineIO first, an EDL beside it, and no FCPXML writer

OTIO is the hub: DaVinci Resolve opens it directly, and OTIO's own adapters (`otioconvert`) turn
it into FCPXML, AAF, FCP 7 XML and others. A writer per destination here would be several readings
of the same lane, each to be kept honest against a different application. One OTIO file plus the
conversion the format's maintainers keep current is one reading. The EDL exists because it is the
one format every editor and every conform still opens, even with no OTIO tooling installed.

The OTIO is written in the OTIO **1** schemas (`Clip.1`, `Gap.1`, `Transition.1`,
`LinearTimeWarp.1`). Every reader loads them, and a newer reader upgrades them on read.
OpenTimelineIO 0.18 reads this output back unchanged, gaps, warps and dissolves included.

## A lane is FLATTENED before either writer sees it

Here a lane is a list of shots in file order, and the later one covers the earlier
([transitions.md](transitions.md)); a covered shot shows again once the one over it ends. Another
editor's track is a SEQUENCE: items end to end, nothing overlapping. `flattenLane` is the one
translation between the two, so OTIO and the EDL cannot read a lane two ways. A shot covered in
its middle becomes two segments of the same clip, the second picking its source up where the
cover ended.

A dissolve is the incoming shot's `fade_in`, so the cut sits at the incoming shot's START and the
outgoing shot runs on under it. In OTIO that is a transition with `in_offset` 0 and `out_offset`
the fade's length; in an EDL, the standard two-line pair. Both assume the outgoing source has the
handle the fade already plays, which it does, since it is playing it here.

## Frames, and the open-ended shot

Times are written in frames at the picture's `fps`, a cut between two frames being no cut an
editor can make. A shot with `length: 0` runs to the next shot's start. The LAST one runs to the
end of its source, so the verb probes that file's length, and only that one. A shot whose
length cannot be learned is left out and listed as left out, rather than given a length nobody
measured.

## What is handed over, and what is not

| here | handed over |
|---|---|
| shots, gaps, dissolves | as clips, gaps and transitions |
| `speed` | OTIO: a `LinearTimeWarp` (a `FreezeFrame` at 0), an EDL an M2 line |
| the media | the camera ORIGINALS, relative to `exports/`, never an optimized copy or a proxy ([media.md](media.md)) |
| lanes, bottom first | OTIO tracks in the same order; an EDL carries one lane |
| a lane of shapes | nothing: there is no media to open |
| `animate`, the lane's rect, a `with:` transition, a lane's shaders | nothing |

The last row is deliberate. A move, a picture-in-picture rect or a GLSL pass has no shared
vocabulary between editors: each application keeps its own keyframes and effects, and OTIO carries
them only as opaque metadata nobody reads back. Handed over as something approximate, they would
arrive WRONG rather than absent, and a wrong position is harder to notice than a missing one. A
named transition goes over as a plain dissolve of the same length.

The sound is not handed over either. A shot's sound lane is the engine's ([../../song/docs/videoSound.md](../../song/docs/videoSound.md)),
and the editor receiving the cut reads each original's own sound.
