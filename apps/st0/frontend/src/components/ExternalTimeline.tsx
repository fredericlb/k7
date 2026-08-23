// ExternalTimeline.tsx — the ARRANGEMENT alone on a second device: the same `TimelineTab` the
// shell's pane draws, with the writing paths it needs wired straight to `/command` instead of
// through the shell. Its own caret, zoom and selection, because those were never the shell's —
// they are the pane's, and a pane is what this is.
//
// See ../docs/external.md.

import type { EngineClient } from "@studio/engine-browser";
import {
  arrayEq,
  type EngineStore,
  useStoreState,
} from "@studio/engine-browser/store";
import { automationLanes, type WebGraph } from "@studio/graph-model";
import type { WebVideoProject, WebVideoTrack } from "@studio/web-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { CommandPrefs } from "../commandPrefs";
import {
  contextMenu,
  type MenuCtx,
  type MenuItem,
  type NodeMenuTarget,
  nodeMenu,
  withAmbient,
} from "../contextMenu";
import { useOrbit } from "../hooks/usePolls";
import { useProjectDoc } from "../hooks/useProjectDoc";
import { useRevision } from "../hooks/useRevision";
import type { SurfaceCommands } from "../hooks/useSurfaceCommands";
import { useTrackControls } from "../hooks/useTrackControls";
import { useVideoEdits } from "../hooks/useVideoEdits";
import { useLocale } from "../i18n";
import type { ConditionCtx } from "../keys";
import type { CommandInfo } from "../types";
import { ContextMenu } from "./ContextMenu";
import { type TimelineHandle, TimelineTab } from "./TimelineTab";

/** All four hoisted so their identity never changes: the timeline takes them as dependencies. */
const NO_LANE_NODES = { alternatives: undefined, frozen: undefined };
const NOOP = () => {};
const EMPTY_VIDEO_TRACKS: WebVideoTrack[] = [];

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
  /** The song's picture, fetched ONCE by the host — the frame composites it and this draws its
   *  lanes, exactly as the shell splits it between the same two panes. */
  videoDoc: WebVideoProject | null;
  /** This person's layer over the catalogue, and the catalogue — both the host's, since the
   *  keymap it also feeds belongs to the whole screen rather than to this pane. */
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

  /**
   * The engine's live take state, exactly as the shell reads it — so an armed lane draws the take
   * as it is played here too. Read at the `rolling` EDGE rather than subscribed to: the playhead
   * moves 20 times a second and this number changes once per take.
   */
  const playing = useStoreState(store, (s) => s.playing);
  const recordEnabled = useStoreState(store, (s) => s.recordEnabled);
  const rolling = recordEnabled && playing;
  const [takeStart, setTakeStart] = useState(0);

  /**
   * The compiled document's shell-side slice. `TimelineTab` fetches the document itself; what is
   * wanted here is the three projections around it — the tempo a take's start is converted with,
   * the lanes the mixer controls act on, and whether this song has patterns worth polling for.
   *
   * `onMidiSeqs` is a no-op and MIDI capture is not offered: recording into a sequence is done by
   * the browser holding the keyboard, and this one is across the room. `transport arm` still
   * works, being the ENGINE's arm — see useTrackControls.
   */
  const noMidiSeqs = useCallback(() => {}, []);
  const { recInfo, docTracks, hasStrudel, midiSeqRef } = useProjectDoc(
    reloadKey,
    { onMidiSeqs: noMidiSeqs },
  );
  useEffect(() => {
    if (!rolling) return;
    setTakeStart((store.getSnapshot().playhead * recInfo.tempo) / 60);
  }, [rolling, store, recInfo.tempo]);

  const orbit = useOrbit(hasStrudel);
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

  /**
   * What the graph knows about each lane's node — its alternatives, its freeze, its automation.
   *
   * Fetched HERE, on the revision token, where the shell takes it from the chains pane: there is
   * no chains pane on this device, and the gutter would otherwise draw no ⋮ and no curve. The
   * same call `SurfaceTab` and `MasteringTab` make, on the same token, for the same reason.
   */
  const rev = useRevision();
  const [graph, setGraph] = useState<WebGraph | null>(null);
  useEffect(() => {
    if (rev === null) return;
    let alive = true;
    api
      .graph()
      // A project that will not compile still has an arrangement worth drawing; the gutter simply
      // has nothing to add to it.
      .then((g) => alive && setGraph(g))
      .catch(() => alive && setGraph(null));
    return () => {
      alive = false;
    };
  }, [rev]);
  const laneNodes = useMemo(
    () =>
      graph
        ? {
            alternatives: graph.trackAlternatives,
            frozen: graph.frozen,
            automation: automationLanes(graph),
          }
        : NO_LANE_NODES,
    [graph],
  );

  // ── the menus ──────────────────────────────────────────────────────────────────
  //
  // The catalogue, this person's layer over it and the language, all read at OPEN time through a
  // ref: a menu handler that depended on them would be rebuilt the moment any of the three landed,
  // and the timeline takes it as a prop. The same three the shell holds, and for the same reasons.
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
    (item: MenuItem) => {
      if (item.complete) void runCommand(item.command);
      else prewrite(item.command);
    },
    [runCommand, prewrite],
  );

  /**
   * What the caret is over, reported up for the conditional bindings.
   *
   * `m`, `s`, `r` name the lane the caret is on and `z` / ⇧L need a rectangle; without this they
   * would resolve to a command with an empty argument, or to none at all. The shell builds the
   * same object out of its own state — this is the surface's share of it, which on a screen
   * holding one arrangement is all of it. See keys.ts.
   */
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
    (v: { selecting: boolean; zoomed: boolean; loop: boolean }) =>
      onConditions((prev) => {
        const next: ConditionCtx = {
          ...prev,
          timeline_selection: v.selecting ? "1" : undefined,
          timeline_zoomed: v.zoomed ? "1" : undefined,
          timeline_loop: v.loop ? "1" : undefined,
        };
        return sameConditions(prev, next) ? prev : next;
      }),
    [onConditions],
  );

  // ── the pane ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1">
        <TimelineTab
          ref={ref}
          // Alone on the screen, so it always has the keys — there is no other pane to give them
          // to. `active` is the shell's answer to a ring of panes this device has not got.
          active
          reloadKey={reloadKey}
          rolling={rolling}
          takeStartBeat={takeStart}
          takeCountInBeats={recInfo.countIn * recInfo.beatsPerBar}
          orbit={orbit}
          videoTracks={videoTracks}
          onVideoEdit={applyVideoEdit}
          setStatus={setStatus}
          // The shell's other panes asking to be pointed somewhere — the editor at the clip under
          // the caret. Not mounted here, so the caret simply moves.
          onEditTarget={NOOP}
          onCaret={onCaret}
          onView={onView}
          onContextMenu={openContextMenu}
          onNodeMenu={openNodeMenu}
          onSeek={seek}
          onSetLoop={(start, end, enabled) =>
            engineRef.current?.loop(start, end, enabled)
          }
          // The writing gestures, each the same command line the shell sends. Spelled here rather
          // than shared with it: what they have in common is the VERB, which is @studio/commands',
          // and a wrapper over four one-line callbacks would be indirection over the thing itself.
          onMoveEvent={(trackId, fromTc, toTc, toTrackId) =>
            void runCommand(
              `event move ${trackId} ${fromTc} ${toTc}${toTrackId ? ` ${toTrackId}` : ""}`,
            )
          }
          onResizeEvent={(trackId, fromTc, startTc, endTc) =>
            void runCommand(
              `event resize ${trackId} ${fromTc} ${startTc} ${endTc}`,
            )
          }
          // `lenTc` is a LENGTH, and the verb's name is the end it applies to — see `event fadein`
          // in commands.yaml for why the pair cannot be swapped.
          onFadeEvent={(trackId, fromTc, which, lenTc) =>
            void runCommand(
              `event ${which === "fadeIn" ? "fadein" : "fadeout"} ${trackId} ${fromTc} ${lenTc}`,
            )
          }
          onNewTrack={() => void runCommand("track new")}
          trackControls={trackControls}
          onTrackToggle={onTrackToggle}
          laneNodes={laneNodes}
        />
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

/** Whether two condition sets say the same thing — so reporting up on every caret move does not
 *  re-bind the key listener, which takes the object as a dependency. */
const sameConditions = (a: ConditionCtx, b: ConditionCtx): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
};
