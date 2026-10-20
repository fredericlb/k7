// ExternalTimeline.tsx — the ARRANGEMENT alone on a second device: the same `TimelineTab` the
// shell's pane draws, with the writing paths it needs wired straight to `/command` instead of
// through the shell. Its own caret, zoom and selection, because those are not the shell's —
// they are the pane's, and a pane is what this is.
//
// See ../docs/external.md.

import type { EngineClient } from "@studio/engine-browser";
import {
  arrayEq,
  type EngineStore,
  useStoreState,
} from "@studio/engine-browser/store";
import { automationLanes } from "@studio/graph-model";
import type { WebVideoProject, WebVideoTrack } from "@studio/web-protocol";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CommandPrefs } from "../commandPrefs";
import {
  contextMenu,
  type MenuCtx,
  type MenuItem,
  withAmbient,
} from "../contextMenu";
import { useProjectDoc } from "../hooks/useProjectDoc";
import { useRevision } from "../hooks/useRevision";
import type { SurfaceCommands } from "../hooks/useSurfaceCommands";
import { useTrackControls } from "../hooks/useTrackControls";
import { useVideoEdits } from "../hooks/useVideoEdits";
import { useLocale } from "../i18n";
import type { ConditionCtx } from "../keys";
import { confirmMenuItem } from "../menuConfirm";
import { type NodeMenuTarget, nodeMenu } from "../nodeMenu";
import { REV_SCOPE, useGraph } from "../queries/graph";
import {
  createShellStore,
  ShellStoreContext,
  type ShellVerbs,
} from "../state/shellStore";
import { modeCondition, type TimelineMode } from "../timelineMode";
import type { CommandInfo } from "../types";
import { ContextMenu } from "./ContextMenu";
import { type TimelineHandle, TimelineTab } from "./TimelineTab";

/** All four hoisted so their identity never changes: the timeline takes them as dependencies. */
const NO_LANE_NODES = { alternatives: undefined, frozen: undefined };
const NOOP = () => {};
const EMPTY_VIDEO_TRACKS: WebVideoTrack[] = [];
// The gestures a second device offers: no tools, no lane order, no picture lane — the shell's pane has those.
const DEVICE_GESTURES = [
  "moveEvent",
  "resizeEvent",
  "fadeEvent",
  "newTrack",
] as const;

export function ExternalTimeline({
  project,
  store,
  engineRef,
  seek,
  commands,
  setStatus,
  videoDoc,
  prefs,
  catalogue,
  prewrite,
  onConditions,
  ref,
}: {
  /** Workspace-relative, as every file route here takes it. */
  project: string;
  store: EngineStore;
  /** For the LOOP, which the link exposes no sender for — see App's own call. */
  engineRef: React.RefObject<EngineClient | undefined>;
  seek: (seconds: number) => void;
  /** The runner and the reload key the whole surface shares — hooks/useSurfaceCommands.ts. */
  commands: SurfaceCommands;
  setStatus: (s: string) => void;
  /** The song's picture, fetched ONCE by the host — the frame composites it and this draws its lanes. */
  videoDoc: WebVideoProject | null;
  /** This person's layer over the catalogue, and the catalogue — both the host's, the keymap belonging to the whole screen. */
  prefs: CommandPrefs;
  catalogue: CommandInfo[];
  /** Put a half-written line in the host's command line. See its own note there. */
  prewrite: (command: string) => void;
  /** What the caret is over, for the host's key listener — the conditional bindings read it. */
  onConditions: (update: (prev: ConditionCtx) => ConditionCtx) => void;
  /** The caret verbs the host answers locally — `v`, `z`, `t`, ⇧L (TimelineHandle). */
  ref?: React.Ref<TimelineHandle>;
}) {
  const { reloadKey, runCommand, quietCommand, bumpReload } = commands;

  /** The engine's live take state, read at the `rolling` EDGE rather than subscribed to: it changes once per take. */
  const playing = useStoreState(store, (s) => s.playing);
  const recordEnabled = useStoreState(store, (s) => s.recordEnabled);
  const rolling = recordEnabled && playing;
  const [takeStart, setTakeStart] = useState(0);

  /** The compiled document's shell-side slice — the tempo and the lanes the mixer acts on. */
  const noMidiSeqs = useCallback(() => {}, []);
  const { recInfo, docTracks, midiSeqRef } = useProjectDoc(reloadKey, {
    onMidiSeqs: noMidiSeqs,
  });
  useEffect(() => {
    if (!rolling) return;
    setTakeStart((store.getSnapshot().playhead * recInfo.tempo) / 60);
  }, [rolling, store, recInfo.tempo]);

  const videoTracks = videoDoc?.videoTracks ?? EMPTY_VIDEO_TRACKS;
  const applyVideoEdit = useVideoEdits(project, bumpReload, setStatus);

  const armed = useStoreState(store, (s) => s.armed, arrayEq);
  const [midiArmed, setMidiArmed] = useState<string | null>(null);
  const { trackControls, onTrackToggle } = useTrackControls({
    docTracks,
    armed,
    midiArmed,
    setMidiArmed,
    midiSeqRef,
    quietCommand,
    bumpReload,
  });

  /** What the graph knows about each lane's node, fetched HERE on the revision token: there is no chains pane on this device. */
  const rev = useRevision();
  const read = useGraph(REV_SCOPE, rev);
  // A project that will not compile still has an arrangement worth drawing; the gutter simply has nothing to add to it.
  const graph = read.error ? null : read.graph;
  const laneNodes = useMemo(
    () =>
      graph
        ? {
            alternatives: graph.trackAlternatives,
            frozen: graph.frozen,
            autoFrozen: graph.autoFrozen,
            autoFreezeWaiting: graph.autoFreezeWaiting,
            automation: automationLanes(graph),
          }
        : NO_LANE_NODES,
    [graph],
  );

  // ── the menus ──────────────────────────────────────────────────────────────────

  // The catalogue, this person's layer and the language, read at OPEN time through a ref — a handler depending on them would be rebuilt as each landed.
  const { locale } = useLocale();
  const cmdCatalogue = useRef<CommandInfo[]>([]);
  cmdCatalogue.current = catalogue;
  const cmdPrefs = useRef<CommandPrefs>({});
  cmdPrefs.current = prefs;
  const cmdLocale = useRef(locale);
  cmdLocale.current = locale;
  const [menu, setMenu] = useState<{
    items: MenuItem[];
    x: number;
    y: number;
  } | null>(null);

  const openContextMenu = useCallback((ctx: MenuCtx, x: number, y: number) => {
    const items = contextMenu(
      withAmbient(ctx),
      cmdCatalogue.current,
      cmdPrefs.current,
      cmdLocale.current,
    );
    if (items.length) setMenu({ items, x, y });
  }, []);
  const openNodeMenu = useCallback(
    (n: NodeMenuTarget, at: { x: number; y: number }) => {
      const items = nodeMenu(n);
      if (items.length) setMenu({ items, x: at.x, y: at.y });
    },
    [],
  );

  // Complete runs, incomplete goes to the host's one line — the same rule the shell's bar follows.
  const pickMenuItem = useCallback(
    async (item: MenuItem) => {
      if (!item.complete) return prewrite(item.command);
      if (await confirmMenuItem(item)) void runCommand(item.command);
    },
    [runCommand, prewrite],
  );

  /** What the caret is over, reported up for the conditional bindings — the surface's share of what the shell builds (keys.ts). */
  const onCaret = useCallback(
    (c: { trackId: string | null }) =>
      onConditions((prev) => {
        const track = c.trackId ?? undefined;
        return prev.caret_track === track
          ? prev
          : { ...prev, caret_track: track };
      }),
    [onConditions],
  );
  const onView = useCallback(
    (v: {
      mode: TimelineMode;
      selecting: boolean;
      zoomed: boolean;
      loop: boolean;
    }) =>
      onConditions((prev) => {
        // The mode is published here too — a second device has no tools, but its keys read the same conditions.
        const next: ConditionCtx = {
          ...prev,
          tl_normal: undefined,
          tl_select: undefined,
          tl_move: undefined,
          [modeCondition(v.mode)]: "1",
          timeline_mode: v.mode,
          timeline_selection: v.selecting ? "1" : undefined,
          timeline_zoomed: v.zoomed ? "1" : undefined,
          timeline_loop: v.loop ? "1" : undefined,
        };
        return sameConditions(prev, next) ? prev : next;
      }),
    [onConditions],
  );

  // The pane reads its verbs and reload key from a shell store of its own, over this surface's runner (state/shellStore.ts).
  const verbs = useRef<ShellVerbs | null>(null);
  verbs.current = {
    setStatus,
    runCommand: (line) => runCommand(line),
    quietCommand: (line) => quietCommand(line),
    openContextMenu,
    seek,
    setLoop: (start, end, enabled) =>
      engineRef.current?.loop(start, end, enabled),
  };
  const [shell] = useState(() => {
    const s = createShellStore({
      scope: "device",
      frozen: false,
      impl: verbs,
      commands: DEVICE_GESTURES,
    });
    s.setState({ reload: { key: reloadKey, files: null } });
    return s;
  });
  // The surface's key is driven by `/revision` (useSurfaceCommands.ts), so the store follows it rather than counting.
  useLayoutEffect(() => {
    if (shell.getState().reload.key !== reloadKey)
      shell.setState({ reload: { key: reloadKey, files: null } });
  }, [shell, reloadKey]);

  // ── the pane ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1">
        <ShellStoreContext.Provider value={shell}>
          <TimelineTab
            ref={ref}
            // Alone on the screen, so it always has the keys — there is no other pane to give them to.
            active
            rolling={rolling}
            takeStartBeat={takeStart}
            takeCountInBeats={recInfo.countIn * recInfo.beatsPerBar}
            videoTracks={videoTracks}
            onVideoEdit={applyVideoEdit}
            // The shell's other panes asking to be pointed somewhere; not mounted here, so the caret simply moves.
            onEditTarget={NOOP}
            onCaret={onCaret}
            onView={onView}
            onNodeMenu={openNodeMenu}
            trackControls={trackControls}
            onTrackToggle={onTrackToggle}
            laneNodes={laneNodes}
          />
        </ShellStoreContext.Provider>
      </div>
      {menu ? (
        <ContextMenu
          items={menu.items}
          prefs={prefs}
          x={menu.x}
          y={menu.y}
          onPick={pickMenuItem}
          onHint={setStatus}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

/** Whether two condition sets say the same thing — so reporting up on every caret move does not re-bind the key listener. */
const sameConditions = (a: ConditionCtx, b: ConditionCtx): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
};
