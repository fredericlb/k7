# The DJ desk: architecture

The DJ desk is the drawer of the `turntables` surface type. It is a builtin **plugin** in `packages/k7-plugins`, mounted by k7's shell. This page covers where its code lives, how a host gives it an engine, and how a gesture becomes sound. The control vocabulary and bindings are in [Desk controls and bindings](./61-turntables-bindings.md); tempo, grids, loops and cues in [Desk timing](./62-turntables-timing.md).

## Where the code lives

| Path | Role |
|---|---|
| `packages/k7-plugins/src/turntables/index.ts` | `turntablesPlugin`: a `definePlugin` with one pane contribution of type `turntables`. No commands, no server half. |
| `packages/k7-plugins/src/browser.ts` | The browser composition list (`BROWSER_PLUGINS`) the shell registers. |
| `packages/k7-plugins/src/turntables/browser.tsx` | `TurntablesPane`, the drawer: fetches the compiled graph, reads `surface.mapping`, `playlist`, `stems`, calls `useDeckSet` and renders `Turntables`. |
| `packages/k7-plugins/src/turntables/engine.ts` | The `Deck` seam: what the desk needs from an engine (types only). Exported as `@studio/k7-plugins/turntables/engine`. |
| `packages/k7-plugins/src/turntables/useDeckSet.ts` | The two decks as one state machine: loads, tempos, sync, cues, every gesture. |
| `packages/k7-plugins/src/turntables/useDeckLoops.ts` | The loop section, a hook of its own. |
| `packages/k7-plugins/src/turntables/deck.ts` | Building the `ProjectDoc` the engine plays: `withDecks`, platter params, sync arithmetic. |
| `packages/k7-plugins/src/turntables/deckVocabulary.ts` | Deck ids, `DeckLoad`, `DeckTempo`, and every control's range. |
| `packages/k7-plugins/src/turntables/controls.ts`, `mapping.ts`, `mixBindings.ts` | Control ids, required controls, binding resolution. |
| `packages/k7-plugins/src/turntables/beats.ts`, `grid.ts`, `loop.ts`, `metronome.ts`, `waveform.ts`, `shuttle.ts`, `dial.ts`, `deskLayout.ts` | Pure arithmetic, each with a test. |
| `packages/k7-plugins/src/turntables/setList.ts`, `prewarm.ts`, `service.ts`, `mixView.ts` | Data: the playlist resolved against the machine's cache, background analysis, the file-service and library calls, reading/writing `mix.yaml`. |
| `packages/k7-plugins/src/turntables/views/` | React components: `Turntables` (the mapping gate), `MixView` (the desk), `DeckSide`, `DeckButtons`, `ChannelStrip`, `MixerColumn`, `BpmFader`, `CueButtons`, `LoopRow`, `Vinyl`, `Waveform`, `SongBrowser`, `inSight.ts`. |
| `packages/k7-plugins/scripts/turntables/put-on.ts` | A measurement script against a running engine; see [Desk tests](./65-dj-tests.md). |

On k7's side:

| Path | Role |
|---|---|
| `apps/k7/frontend/src/plugins.ts` | Registers `builtinBrowserPlugins()` into the shell's surface drawers. |
| `apps/k7/frontend/src/surfacePanes.ts` | The registry of surface drawers, with the two mount shapes (`ShellPaneProps` for the pane ring, `DeviceSurfaceCtx` for a second device). |
| `apps/k7/frontend/src/hooks/useTurntableDeck.ts` | k7's implementation of the `Deck` seam over its engine link. |
| `apps/k7/frontend/src/components/ExternalSurface.tsx` | The same drawer mounted alone on a second device. |
| `apps/k7/frontend/src/routes.ts` | `viewPanes`: a `turntables` pane exists in the ring only when the project declares the surface. |
| `apps/k7/frontend/src/keys.ts` | `4` is `ui turntables`. |

The surface type itself is a builtin of the schema (`packages/song-schema/src/yaml/surfaceSchema.ts`), so the plugin registers no type, only its drawing.

## The `Deck` seam

The desk never obtains an engine. A host passes a `Deck` (`engine.ts`):

| Member | Use |
|---|---|
| `phase` | `looking`, `absent`, `taken` (claim held elsewhere) or `ready`. |
| `engine` | The `EngineClient` for live param writes (`setPluginParam`), transport and seek. |
| `sendProject(doc)` | Send a whole document. A seam because who may write to an engine is the host's decision. |
| `playhead`, `drawNow` | The transport position as a raw anchor (for values written down) and steered (for drawing). |
| `platters` | Each platter's needle in seconds of its record, by plugin id. A deck has no other clock. |
| `params`, `watchParams` | The live plugin-param store; a knob reads engine values through it. |
| `moduleParams`, `setModuleParam` | Values the desk lends to `offline` modules (the tempo), so the graph shows them. |
| `listening`, `setListening`, `listenStats`, `retry` | Optional. k7 provides none: it has no stream player, so the desk's "Listen here" box is not drawn in k7. |

`useTurntableDeck` builds this from k7's existing engine link and plugin-param store. The desk and k7's graph must read the same param store or two pictures of one plugin disagree.

## The document

The engine never parses song files. The desk takes the **compiled** project (`projectApi.engineDoc()`), and `withDecks` (`deck.ts`) fills in only what is live:

- For each deck track, and each of its four stem lanes, the declared **platter** plugin (`PLATTER_TYPE = "studio_turntable"`, node `@meta/audio/turntable`) gets `deckFile` (the absolute path on the engine's machine) plus `Rate` and `Key`.
- An unseparated record plays on the deck's own lane and leaves the stem lanes empty; a separated one is the reverse (`load.stems`). Stem files are `stems/<stem>.wav` beside the record (`stemSource`).
- `Seek` is **removed** from the declared params on every send. The node file declares `Seek: 0`, and the engine reads a changed seek as a needle drop; re-asserting it on each document (a tempo drag sends one every 120 ms) would be heard as crackle.
- A metronome track is appended (`metronome.ts`), always present, with clips only when the click is on.

Before the compile lands, `deckDoc` builds a stand-in document from nothing so a desk can play immediately.

`sendDecks` routes through `deck.sendProject`. The document is re-sent on: a load, a tempo drag (throttled, `LIVE_WARP_MS = 120`, skipped under `LIVE_WARP_BPM = 0.05`), a release, sync, keylock, metronome, a deck started or stopped, stems arriving.

### Two write paths

| Path | Used for | Why |
|---|---|---|
| Live param (`engine.setPluginParam`) | EQ, filter, trim, level, echo, cue, stems, crossfade, scratch (`Rate`, `Key`), seek (`Seek`), loops (`Roll`, `LoopStart`, `LoopEnd`) | A real plugin param, sent per pixel. |
| Document re-send | Tempo, deck start/stop, loads, click | The tempo module is `offline` and compiles to no plugin; the platter's `Rate` realises it. Which decks turn is live state the document must carry, or a re-send would stop them. |

### Transport

Each platter runs on its own; the engine transport commands none of them (`deckRunning`). The transport only carries the click: `useDeckSet` seeks to 0 and plays when any deck starts, and stops when none runs.

### Optimistic values

A knob's displayed value is the hand's value until the engine reports the same (`shownValue`, `engineAgrees` in `mixBindings.ts`, epsilon 0.05). Then the override is dropped and the engine's value shows. This is what keeps the crossfader from re-centring when the pane is hidden and shown.

## State ownership

`useDeckSet` is called by the drawer, which the shell mounts once and hides rather than unmounts. A set's state (what is loaded, the crossfader) therefore survives switching to the graph or the editor. `views/inSight.ts` tells meters and the spinning record to go still while the pane is hidden.

`MixView` owns what is view-local: waveform envelopes, the song browser, separation polling, the prewarm walk. A load token per deck (`waveFor`, `prepFor`) makes a late answer for an outgoing record harmless.

## Data sources

| Data | From | Through |
|---|---|---|
| Songs on the engine's machine | The file service on that machine's side (`cfg().base`) | `service.summary`, `service.songs` (`/mediatek`, `/mediatek/list?family=songs`) |
| A song's envelope, onsets, tempo | Same | `service.envelope` (`/mediatek/envelope`), see [Desk timing](./62-turntables-timing.md#analysis) |
| The playlist text | The workspace (`_playlists/…`) | `readPlaylistText` (`mixView.ts`) |
| Cue sheet | `mix.yaml` in the project | `readMixText` / `writeMixText` |
| Tempo/key corrections, stems | The media library (k7's backend, `libraryBase`) | `service.setSongBpm`, `setSongKey`, `prepareStems`, `stemsHeld`, `separation` |

File-service calls carry `fileHeaders()`; library calls carry the session cookie (`credentials: "include"`). Errors surface the server's own sentence when it sends one.

## Extending

- **A new desk control**: add it to `MIX_CONTROLS` in `controls.ts` (and to `REQUIRED_CONTROLS` in `mapping.ts` only if a desk is unusable without it), add its row to `SURFACE_MAPPING_SKELETON.turntables` in `packages/song-schema/src/yaml/surfaceSchema.ts`, wire it in `scaffoldSet.ts`, and expose `xOf`/`xLive`/`turnX` from `useDeckSet`. `mapping.test.ts` holds the schema skeleton and the control list together.
- **A third deck**: `DECKS` in `deckVocabulary.ts` and `packages/song/src/scaffoldSet.ts`; control ids, stem names and required controls derive from it. The views still mount two `DeckSide`s explicitly.
- **Another host**: implement `Deck`, mount `TurntablesPane` with a `ProjectSurface`, a project path, a library base and a revision token.
