// MixerTab.tsx — the channel strips, side by side, drawn where the GRAPH is. Every module a
// track ends on (its MIXER, see @studio/song's trackMixer) as the card the chains view draws,
// in the song's track order. Nothing here is hand-rolled: a strip's controls are its module's
// own panel, and `moduleRow` gives them their even spacing. See docs/shell.md.

import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { TrackControlValues } from "@studio/ui-chains/graph";
import { moduleRow } from "@studio/ui-chains/graph";
import { DomChains } from "@studio/ui-chains-react";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { STUDIO_ICONS } from "../chainsIcons";
import type { MenuCtx } from "../contextMenu";
import { mixerModules } from "../mixerStrips";
import { m } from "../paraglide/messages.js";
import type { WebGraph, WebProject } from "../types";

/** Strips are drawn 1.5× the width their grid asks for — read side by side, a card sized exactly
 *  to its controls reads as cramped. Elbow room, not bigger controls: see moduleRow. */
const STRIP_WIDTH_SCALE = 1.5;

export function MixerTab({
  reloadKey,
  command,
  trackOrder,
  pluginParamsStore,
  requestPluginParams,
  watchPluginParams,
  setPluginParam,
  trackControls,
  onContextMenu,
  engineWarnings,
  onClose,
}: {
  reloadKey: number;
  command: (line: string) => void | Promise<void>;
  /** The engine's level order — a fader draws its track's VU beside the throw. */
  trackOrder: string[];
  // The same live-param plumbing the chains view runs on: these ARE those cards.
  pluginParamsStore: PluginParamsStore;
  requestPluginParams: (id: string) => void;
  watchPluginParams: (id: string, on: boolean) => void;
  setPluginParam: (id: string, name: string, value: number) => void;
  trackControls?: Record<string, TrackControlValues>;
  onContextMenu?: (ctx: MenuCtx, x: number, y: number) => void;
  engineWarnings?: Record<string, string>;
  /** Put the graph back. Present because the mixer is a view of the graph's pane, and every
   *  other thing that takes that place closes the same way. */
  onClose?: () => void;
}) {
  const [proj, setProj] = useState<WebProject | null>(null);
  const [graph, setGraph] = useState<WebGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Both, because neither answers alone: the project says WHICH modules are strips and in what
  // order, the graph says what each one looks like.
  useEffect(() => {
    Promise.all([api.projectDoc(), api.graph()])
      .then(([p, g]) => {
        setProj(p);
        setGraph(g);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, [reloadKey]);

  const modules = useMemo(() => mixerModules(proj), [proj]);
  const laid = useMemo(
    () => (graph ? moduleRow(graph, modules, STRIP_WIDTH_SCALE) : null),
    [graph, modules],
  );

  // The plugins these strips draw, so their knobs show what the engine holds rather than what the
  // file last said. Asked once per row, then followed — the same pair ChainsTab runs.
  const pluginIds = useMemo(
    () =>
      (laid?.nodes ?? [])
        .map((n) => n.pluginId)
        .filter((id): id is string => !!id),
    [laid],
  );
  useEffect(() => {
    for (const id of pluginIds) requestPluginParams(id);
  }, [pluginIds, requestPluginParams]);
  useEffect(() => {
    for (const id of pluginIds) watchPluginParams(id, true);
    return () => {
      for (const id of pluginIds) watchPluginParams(id, false);
    };
  }, [pluginIds, watchPluginParams]);

  if (error) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!proj || !laid)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {m["common.loading"]()}
      </div>
    );
  if (!laid.nodes.length)
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {proj.tracks.length
          ? "no track in this song ends on a mixer module — nowhere to put a level"
          : m["mixer.noTracks"]()}
      </div>
    );

  return (
    // h-full: fill the pane it was given, so the canvas frames to it.
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Mixer</span>
        <span>
          · {laid.nodes.length} strip{laid.nodes.length > 1 ? "s" : ""}, in
          track order · the modules' own panels
        </span>
        {onClose && (
          <button
            type="button"
            className="ml-auto rounded p-1 hover:bg-accent hover:text-foreground"
            title="Close — back to the graph"
            aria-label="Close the mixer"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <DomChains
          icons={STUDIO_ICONS}
          graph={laid}
          selected={selected}
          onSelect={setSelected}
          trackOrder={trackOrder}
          // Re-frame when the ROW changes, not on every refetch: a param landing must not take the
          // camera back from wherever it was panned. Same rule as the chains view's fitKey.
          fitKey={modules.join("|")}
          // Fill the panel's HEIGHT and let the row run off the right, which pans. Fitting both
          // axes would shrink every strip as the song gains tracks, and a mixer you cannot read
          // is worse than one you have to scroll.
          fitAxis="height"
          command={command}
          onContextMenu={onContextMenu}
          engineWarnings={engineWarnings}
          pluginParamsStore={pluginParamsStore}
          setPluginParam={setPluginParam}
          trackControls={trackControls}
        />
      </div>
    </div>
  );
}
