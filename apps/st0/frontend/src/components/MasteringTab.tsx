// MasteringTab.tsx — the `mastering` surface: one quick-master node drawn as the three
// appliances it is, in the order the signal meets them. st0's half of `surfaces/`, beside
// TimelineTab and ViewportTab.
//
// Drawn by the shell rather than by `SurfaceTab` because what it needs is the ENGINE LINK —
// `setPluginParam`, `watchPluginParams` and the params store — and that lives up in `App`.
// See ../../docs/mastering.md and packages/song/docs/surfaces.md.

import {
  type PluginParamsStore,
  usePluginParamValue,
} from "@studio/engine-browser/params";
import type { WebGraph } from "@studio/graph-model";
import type { ProjectSurface } from "@studio/song-schema/yaml/surfaceFile";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useRevision } from "../hooks/useRevision";
import {
  engineAgrees,
  type MasterBinding,
  masterRange,
  resolveMasterBindings,
  shownValue,
} from "../mastering/bindings";
import {
  MASTER_PARTS,
  type MasterPart,
  mappedModules,
  PART_LABEL,
  unmappedControls,
} from "../mastering/controls";

export function MasteringTab({
  surface,
  paramsStore,
  setPluginParam,
  watchPluginParams,
}: {
  surface: ProjectSurface;
  paramsStore: PluginParamsStore;
  setPluginParam: (id: string, name: string, value: number) => void;
  watchPluginParams: (id: string, on: boolean) => void;
}) {
  /**
   * The compiled chains, fetched here on the revision token — the same call `SurfaceTab` and
   * `ChainsTab` make, and for the same reason: `App`'s `seedGraph` is the graph a writing command
   * handed back, which is a different thing from "the project's current graph".
   */
  const rev = useRevision();
  const [graph, setGraph] = useState<WebGraph | null>(null);
  useEffect(() => {
    if (rev === null) return;
    let alive = true;
    api
      .graph()
      // A project that will not compile still has a strip worth drawing: the bindings resolve to
      // nothing and say so, which is the screen you fix it from.
      .then((g) => alive && setGraph(g))
      .catch(() => alive && setGraph(null));
    return () => {
      alive = false;
    };
  }, [rev]);

  const mapping = surface.surface.mapping;
  const { bindings, problems } = useMemo(
    () => resolveMasterBindings(mapping ?? {}, graph),
    [mapping, graph],
  );
  const missing = useMemo(() => unmappedControls(mapping), [mapping]);
  const modules = useMemo(() => mappedModules(mapping), [mapping]);

  /**
   * Ask the engine to REPORT the plugins this strip draws.
   *
   * Nothing arrives otherwise: a plugin's values are pushed only while something is watching it,
   * so without this every knob would sit on its `home` for as long as the project is open and
   * look like a working control that the engine simply disagreed with.
   *
   * The effect is keyed by a SERIALISED list rather than by the array: `bindings` is a fresh array
   * on every graph fetch, so an effect depending on it would unwatch and re-watch on each poll — a
   * subscription that flickers twenty times a minute over a set of ids that has not changed.
   *
   * JSON rather than a joined string, so there is no separator to collide with: a plugin id is
   * `chain:module`, and picking a character on the grounds that no name contains it today is how a
   * watch quietly starts covering half a plugin.
   */
  const watchKey = useMemo(
    () => JSON.stringify([...new Set(bindings.map((b) => b.pluginId))].sort()),
    [bindings],
  );
  useEffect(() => {
    const ids = JSON.parse(watchKey) as string[];
    for (const id of ids) watchPluginParams(id, true);
    return () => {
      for (const id of ids) watchPluginParams(id, false);
    };
  }, [watchKey, watchPluginParams]);

  // The GATE. A strip with an unwired control is the same strip with a knob that does nothing,
  // and a knob that does nothing is the hardest thing on a screen to diagnose — so the surface
  // says what it is missing instead of drawing itself. See ../mastering/controls.ts.
  if (missing.length)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-6 text-sm">
        <p className="text-muted-foreground">
          Cette surface est le portrait d'UN module quick-master, et{" "}
          {missing.length === 1
            ? "un de ses composants n'est pas mappé"
            : `${missing.length} de ses composants ne sont pas mappés`}{" "}
          — voir <code className="font-mono">{surface.file}</code>.
        </p>
        <ul className="list-inside list-disc text-muted-foreground">
          {missing.map((c) => (
            <li key={c.id}>
              <code className="font-mono">{c.id}</code> — {c.wants}
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
      {/* Which node this is a picture of. One line, and it is the thing worth knowing first:
          every knob below is on that module, and the graph underneath is where to check it. */}
      <p className="shrink-0 text-xs text-muted-foreground">
        {modules.length === 1 ? (
          <>
            Module <code className="font-mono">{modules[0]}</code>
          </>
        ) : (
          <>
            Cette surface pilote {modules.length} modules :{" "}
            {modules.map((m) => (
              <code className="mr-1 font-mono" key={m}>
                {m}
              </code>
            ))}
            — un pupitre de mastering en décrit normalement un seul.
          </>
        )}
      </p>

      <div className="flex min-w-0 flex-wrap items-start gap-3">
        {MASTER_PARTS.map((part) => (
          <Part key={part} part={part} bindings={bindings}>
            {bindings
              .filter((b) => b.control.part === part)
              .map((b) => (
                <Knob
                  key={b.control.id}
                  binding={b}
                  store={paramsStore}
                  onSet={setPluginParam}
                />
              ))}
          </Part>
        ))}
      </div>

      {/* The lines that named something the project has not got. Reported rather than dropped:
          this file names THIS project's own nodes, so a line that will not resolve is a typo
          somebody made about their own project. */}
      {problems.length > 0 && (
        <ul className="shrink-0 list-inside list-disc text-xs text-destructive">
          {problems.map((p) => (
            <li key={p.control}>
              <code className="font-mono">{p.control}</code> — {p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One of the three appliances: a titled box holding its own knobs. */
function Part({
  part,
  bindings,
  children,
}: {
  part: MasterPart;
  bindings: readonly MasterBinding[];
  children: React.ReactNode;
}) {
  const has = bindings.some((b) => b.control.part === part);
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded border border-border p-3">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {PART_LABEL[part]}
      </h3>
      {has ? (
        <div className="flex flex-col gap-2">{children}</div>
      ) : (
        // Every control is required, so this is only reachable while the graph has not arrived or
        // will not compile — a box that says so beats three empty rectangles.
        <p className="text-xs text-muted-foreground">
          aucun de ses réglages ne se résout pour l'instant
        </p>
      )}
    </section>
  );
}

/**
 * One control: a slider in the param's own units, with the number it is about to send.
 *
 * Subscribed to ITS param and nothing else, so the ~20 frames a second the engine pushes for this
 * plugin end at `Object.is` for the nine knobs that did not move.
 */
function Knob({
  binding,
  store,
  onSet,
}: {
  binding: MasterBinding;
  store: PluginParamsStore;
  onSet: (id: string, name: string, value: number) => void;
}) {
  const live = usePluginParamValue(store, binding.pluginId, binding.param);
  /** The hand's value while a gesture is in flight. Optimistic, and dropped as soon as the engine
   *  agrees — an override that never yields is a control that has stopped listening. */
  const [held, setHeld] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (held !== undefined && engineAgrees(binding, held, live))
      setHeld(undefined);
  }, [binding, held, live]);

  const { min, max, step } = masterRange(binding);
  const { label, unit, home } = binding.control;
  const value = shownValue(held, live) ?? Math.min(max, Math.max(min, home));
  // A step of 1 or more is a whole number; anything finer keeps one decimal. Reading a crossover
  // as "3000.0 Hz" is noise, and a ceiling as "0 dB" when it is at −0.3 is a lie.
  const shown = step >= 1 ? Math.round(value) : value.toFixed(1);

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="w-40 cursor-pointer accent-foreground"
        onChange={(e) => {
          const v = Number(e.target.value);
          setHeld(v);
          onSet(binding.pluginId, binding.param, v);
        }}
      />
      <span className="w-16 shrink-0 text-right font-mono tabular-nums">
        {shown}
        <span className="ml-0.5 text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
}
