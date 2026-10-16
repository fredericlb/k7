# The timeline component

`apps/k7/frontend/src/components/TimelineTab.tsx` is the arrangement pane. It is large because it
holds every continuous interaction of the timeline in one place; the discrete actions are not in
it. The file header states the split: caret movement, growing the `v` rectangle and the drags live
here; every discrete action is a key binding naming a command, run by the shell through this
component's imperative handle.

## Inputs

| Input | Source |
|---|---|
| The compiled song | `useDocument(() => api.projectDoc(), reloadKey)` — re-read when the shell bumps `reloadKey`. |
| Picture lanes | `videoTracks` prop, from the second compile of the same folder (`apps/k7/frontend/src/hooks/useVideoDoc.ts`). |
| Automation rows | `laneNodes.automation`, from the graph. |
| Live state | `useEngineState` from `@studio/engine-browser/store`: the armed set, the engine's loop, levels. |
| Mixer toggles | `trackControls` / `onTrackToggle`, from `apps/k7/frontend/src/hooks/useTrackControls.ts`. |
| Command-bar feeds | `feedMove`, `feedTimecode`, `feedEventsMove` — present only while the bar is filling a form those gestures can answer. |

The playhead, the recording block and each lane meter subscribe to the engine store **themselves**
(`Playhead`, `RecordingClip`, `LaneMeter` at the top of the file) and write to the DOM per animation
frame through `apps/k7/frontend/src/hooks/usePlayheadFrames.ts`. A transport frame therefore re-renders one div, never
the lanes.

## The row model

`projectRows` in `apps/k7/frontend/src/rows.ts` flattens the song into rows: a group header with its
members under it, each track followed by its automation rows, then the picture lanes last and
reversed (a picture lane higher up is in front). A row is identified by a key, never an index
(`track:<id>`, `group:<id>`, `video:<id>`, `auto:<id>:<param>`), because adding a lane renumbers
everything. `Minimap.tsx` builds the same rows from the same function so the two line up.

`index` on a track row is its position in the original track array, which is what the engine's
level array is indexed by; grouping reorders the display only.

## View state

All of it is React state and none of it is written:

| State | Notes |
|---|---|
| `caret` | `{ row, beat }`; `beat === LABEL` (−1) means parked on the row's name. `clampCaret` keeps it legal as rows come and go. |
| `sel` | Anchor and head cells. Walks every row, unlike the caret. |
| `zoom` | A stack of viewports (beat range + row range). The top is the view; popped automatically when its rows disappear. |
| `zoomX` | Horizontal scale from `useHZoom` (`packages/ui-timeline/src/panZoom.ts`); 1 is fit. |
| `move`, `resize`, `fade`, `vdrag` | The four drags in flight, each with a `pending` flag held until the next document. |
| `tool` | One of `TOOLS` in `timelineTools.ts`. Chosen, never derived. |
| `rulerMode` | `bars` or `seconds`. |
| `wantExpanded`, `showAutomation` | The two view toggles. |
| `loop` | The drawn loop band, adopted from the engine when the engine's loop changes. |

The keyboard **mode** (`normal`, `select`, `move`) is derived from `move` and `sel` by
`timelineMode` in `apps/k7/frontend/src/timelineMode.ts` rather than stored, so it cannot disagree
with them. The mode and the tool are reported upward through `onView`, which is what the shell's
conditional key bindings read (`timeline_selection`, `timeline_zoomed`, `tool_held`…).

## Geometry

The beat range on screen fills the pane: `ppb = availW / spanBeats * zoomX`. One function,
`x(beat) = (beat - beatLo) * ppb`, positions everything, so nothing drawn can drift from anything
else. The name column (`GUTTER`) does not scale; it is sticky, and its width is the constant from
`packages/ui-timeline/src/lanes.ts` scaled by 1.3 — the gutter width is what both the caret's
left-of-first-beat test and the zoom anchor subtract, so it must be one value.

Clips are only drawn inside a window of one screen either side of the viewport, snapped to half
screens so scrolling re-renders only when a boundary is crossed (`ClipWindow`, `readClipWin`). A
clip in hand is always drawn.

## Ruler and snapping

`rulerScale` and `rulerTicks` in `apps/k7/frontend/src/components/Ruler.tsx` choose the tick ladder
for the current zoom: bars subdivide by halving (`subdivideBeats` from `@studio/ui-waveform`),
seconds walk the decimal ladder in `packages/ui-timeline/src/ticks.ts`, and with a picture at `fps`
the sub-second rungs are whole frames. Labels thin out by a stride computed on the bar's own index,
so scrolling never moves them. The same component draws the clip editors' rulers, and the `Grid`
continues the ticks down the lanes.

Every gesture snaps to **the ticks actually drawn**. Clicks on the ruler and file drops use
`nearestTick` over the cached tick list; drags snap their **offset** to the ruler's unit at the
moment of the grab (`unitRef`), through `apps/k7/frontend/src/snap.ts`:

| `snapMode(e)` | Meaning |
|---|---|
| `grid` | Land on the grid. |
| `relative` (Ctrl/Cmd) | Move by whole steps, keeping the event's offset from the grid. |
| `free` (Shift) | No snap. |

The modifier is read live on each pointer event, the step at the grab — so a zoom mid-drag cannot
change what a drag means. `moveOffset` never lets a clip go before the song's start.

## The drags

| Drag | Starts on | Commits as |
|---|---|---|
| Clip move | Pointer down on a clip, left button, no Shift | `event move t from to [toTrack]`. The target lane comes from `elementFromPoint` → `[data-lane-track]`, accepted only if its `contentType` takes this clip's kind and it is not generated. |
| Resize | The narrow strips inside each end | `event resize t at start end` (end is a position) |
| Fade | The 2×2 handles at the top corners | `event fadein|fadeout t at length` (length is a duration) |
| Picture shot | Body, left or right trim strip | A list of field edits in seconds via `onVideoEdit` (picture range) |
| Header reorder | The gutter, past 4 px | `track order lane target` / `picture lane order …` |
| Ruler | Horizontal = rectangle over all rows, vertical = zoom, click = seek | — |
| Shift on a lane | Grows `sel` from the caret | — |

Every drag goes through `usePointerFollow` (`packages/ui-timeline/src/drag.ts`), which follows one
pointer on the window and abandons cleanly on `pointercancel`. A drag that ends where it started
writes nothing, and a press that never passed the 4 px slop is a **click**: on a clip it covers
the clip with the selection rectangle (`coverClip`); only a double-click opens it.

A drag while the bar is filling `event move` answers the form instead of committing; a click on the
ruler while a timecode field is active answers it instead of seeking.

## Tools

A tool other than the pointer intercepts the press in `beginClipDrag` before any drag starts, and
calls `toolLine` / `pictureToolLine` (`apps/k7/frontend/src/timelineTools.ts`) to get the command,
or a refusal note. Each tool stands on one verb — `event split`, `event remove`,
`event status mute` (sent bare so the verb toggles), `event crossfade` — which is why there is no
pencil: drawing a clip would be `sequence new` plus `event add`, two journal entries for one press.
The crossfade tool is the one that is not a single press: `crossfadePair` picks the neighbour by
which half of the clip was pressed, and a drag sizes the length (an eighth-beat grid, twice the
distance travelled).

## The imperative handle

`TimelineHandle` is what the shell's local commands call: `toggleSelect`, `zoomIn`, `zoomOut`,
`zoomReset`, `seekToCaret`, `stepTarget`, `toggleLoop`, `copy`, `pasteLine`, `deleteLine`,
`splitLine`, `startMove`, `toggleRuler`, `toggleLanes`, `toggleAutomation`, `setTool`. The ones that
write return `{ line?, note }` — a command line for the shell to run and a sentence for the status
line — rather than running anything themselves. That keeps the pane free of the command plumbing
and makes paste and delete one journal entry each (`events add` / `events remove` with a JSON
payload).

## The clipboard

`apps/k7/frontend/src/clipboard.ts` holds one slot, either notes or events, in coordinates relative
to the rectangle's corner. An item is in a rectangle when it **starts** inside (`notesInRegion`,
`copyEvents`), and deletion uses the same rule so copy and delete cannot disagree. Pasting carries
the placement's own fields (`from`, `to`, fades, loop, disabled, warp) rebuilt key by key — a
wholesale spread would carry an unknown future field into `events add`, which validates each entry
against `PlacementSchema`. Rows that run out of lanes are dropped and counted, never folded onto the
last lane.

## File drops

The pane accepts OS files only when `acceptsFileDrop` (`apps/k7/frontend/src/fileDrop.ts`) says the
drag carries files; calling `preventDefault` on `dragover` is what accepts a drop, and getting that
wrong fails silently. `planDrop` in `apps/k7/frontend/src/timelineDrop.ts` decides each file's kind
by extension (video first, since `.webm` is in both lists), its clip id (the stem, accents folded),
and which lane it lands on. `apps/k7/frontend/src/hooks/useTimelineDrop.ts` then runs the three steps in the only order
that works: upload and declare every file (`clipFiles.ts`'s `fileClip`, shared with recorded
takes), report, then one `event add` / `picture add` per placement, and `picture sound` per picture
lane that received a shot.

## History marks

The History panel hands the timeline a `HistoryMark` (`apps/k7/frontend/src/historyMarks.ts`):
lanes and clips a journal step touched, read off its file paths. The lane tints and the clip gets
an amber outline. Nothing else reads it.

## Read-only

`readOnly` (a shared snapshot) removes the edge and fade handles, stops clip moves, and the shell
passes no `onToolLine`, `onDropFiles`, `onNewTrack` or `onReorder`; the absence of a handler is the
read-only switch for each feature.

## See also

- [The edit path](./21-edit-path.md)
- [Testing the arrangement code](./28-arrangement-tests.md)
