# scaffold.ts — extended notes

The two **timeline archetypes** behind `POST /project/create` (the file service scaffolds at the
workspace root, `createProjectIn`). Lives in `@studio/song` because the bundled sample video the
`video` archetype copies is a `@studio/song` asset.

## The three archetypes, and why they are named after surfaces

`PROJECT_SHAPES` is `["arrangement", "mix", "video"]`, and each name is the **surface the project
opens on**:

| archetype | surfaces | written by |
|---|---|---|
| `arrangement` | `timeline` | `projectFiles` |
| `mix` | `turntables` | `setProjectFiles` ([setProject.md](setProject.md)) |
| `video` | `timeline` + `viewport` | `videoProjectFiles` |

That is the whole of what is being chosen. Every one of them is an `.k7` folder opened by the same
k7 out of the same loader, so "what kind of project is this" has no answers left to arbitrate —
what differs is the screen it declares ([surfaces.md](surfaces.md)).

A scaffolded project is minimal, valid, and immediately playable: one MIDI track (a rising
C-major scale) through a built-in 4OSC synth to OUT, plus a live Strudel pattern. Every file
carries its mandatory params, so the project loads and plays as-is and doubles as a worked
example to edit.

## `video` is `arrangement` plus picture, by construction

`videoProjectFiles` spreads `projectFiles` and adds four things: a `surfaces/viewport.yaml`, a
clip, a `video_tracks/main.yaml`, and the bundled `clips/sample.mp4` — plus the two header lines
`viewport:` and `layers:`, which live inside `project.yaml` rather than in a file of their own and
are therefore the one entry re-derived instead of shared.

Built by **adding** rather than by restating, so the graph, the synth and the settings cannot
drift between the two. `scaffold.test.ts` pins that entry for entry: the day someone rewrites a
line in one map instead of both, the failure names the file rather than showing up as a project
that only misbehaves once opened.

The sample video is **copied**, not referenced where the package sits: a project pointing into the
installed `@studio/song` would stop opening the day the package moved, and a song is a folder you
commit.

### Why an arrangement gets none of it

Not because picture is optional-and-off, but because `loadVideoProject` **requires** a viewport.
A header carrying one is a promise that something composites into it; writing it everywhere would
put a frame around nothing in every project with no shot to place, and the letterboxing would only
be discovered at the export. So an `arrangement` is not a `video` project with its picture deleted
— it never declared a frame, and the loader says so out loud.

## There is no `live` archetype

A fourth archetype for the signal path with the arrangement taken out — a rig, the chains graph
and no surface at all — is an entry whose whole description is "none of them", which is not a
choice anybody makes on purpose once the archetypes are named after their surfaces.

**And there is no MODE either.** `project_type: live` is a root key saying a folder has no
arrangement. Nothing writes or reads it: what a project draws is what its `surfaces/` folder
says, and a second declaration free to disagree with that is worse than none. The schema still
ACCEPTS the key so every set and bench on disk keeps opening — see `projectSchema.ts`, the only
place it is mentioned.

A bare rig is therefore not a kind of project, just a folder that declares no surfaces. You get
one by starting from a mix and throwing the desk away.

## `mix` is excluded from the type, not defaulted away

`TimelineShape` is `Exclude<ProjectShape, "mix">`, so `scaffold(dir, name, "mix")` does not
compile: it would otherwise write a song into a folder whose whole point is that it has no
arrangement. `scaffoldSet.ts` answers for that one, and `projectLifecycle.ts` is where the three
are dispatched. The default is `arrangement`, which is what a bare `scaffold(dir, name)` means.

## The picture's outputs are SPLICED, not restated

`videoGraph` runs `addVideoRun` (videoOutputs.ts) over the arrangement's graph — the same splice
the open path makes on a project that arrives without the run — so the archetype and the repair
cannot write the line two different ways. Restated, it is the shape `MIX: [ OUT ]` has: one line
spelled once per scaffold and once more in a migration script, free to drift. The explanatory `#`
note above it is scaffold.ts's job: the splice writes a line, not a reason.

It throws if the base graph ever loses its `modules:` map. That cannot happen from outside — the
text is a few lines up in the same file — and a `video` project silently scaffolded without a
frame's way out is worse than a failed scaffold.

## `curves/` exists from the start, and empty

Every other entity folder appears as a side effect of scaffolding a file into it, but a new song
has no curve to write — and a folder that isn't there is one the editor can't offer and `curve new`
has to invent. Git tracks files, not directories, so keeping it costs a file: `curves/.gitignore`,
which deliberately ignores NOTHING. A pattern in it would hide the curves themselves. Unconditional:
every song gets curves.

## The arrangement is a surface a song ASKS for

The timeline is a surface ([surfaces.md](surfaces.md)), so a folder that draws one says so in
`surfaces/timeline.yaml` — the way a set says it wants a desk. It is scaffolded because a new song
is a song: the alternative was a first screen with no lanes on it and nothing to explain why. The
`video` archetype's `surfaces/viewport.yaml` is declared the same way, since a song's picture and a
song's sound are one folder and this archetype gets a lane of each — otherwise picture is a feature
you could only discover by reading about it.

## Nothing points at the shared folders

A project sees the workspace's own `_modules` and the account's library repository because of
WHERE they are (sharedFolders.ts). Writing those lists into `project.yaml` would write down facts
the loader already knows, and leave a project wrong the day one of them moves.

## Why the files are hand-authored

Every file here is authored by hand rather than serialised from an object, because the COMMENTS
are the point: a new project is the one worked example a reader gets, and the explanation has to
sit next to the field it explains. (Those `#`-prefixed lines inside the template strings are the
SCAFFOLDED FILES' own comments — they ship to the user's disk verbatim and are not TypeScript
comments; they're deliberately left in full.)
