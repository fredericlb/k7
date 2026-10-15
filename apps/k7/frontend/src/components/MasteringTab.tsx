// MasteringTab.tsx — the `mastering` surface: one quick-master node drawn as the three
// appliances it is, in the order the signal meets them. k7's half of `surfaces/`, beside
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
import { m } from "../paraglide/messages.js";

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
  /** The compiled chains, fetched here on the revision token — `App`'s `seedGraph` is a command's answer, not the project's current graph. */
  const rev = useRevision();
  const [graph, setGraph] = useState<WebGraph | null>(null);
  useEffect(() => {
    if (rev === null) return;
    let alive = true;
    api
      .graph()
      // A project that will not compile still has a strip worth drawing: the bindings say so, and it is the screen you fix it from.
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

  /** Ask the engine to REPORT the plugins this strip draws — keyed by a SERIALISED list, so a fresh array per poll does not re-watch. */
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

  // The GATE: a knob that does nothing is the hardest thing on a screen to diagnose, so the surface says what it is missing instead.
  if (missing.length)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-6 text-sm">
        <p className="text-muted-foreground">
          {m["mst.portrait"]()}{" "}
          {missing.length === 1
            ? m["mst.oneUnmapped"]()
            : m["mst.someUnmapped"]({ n: missing.length })}{" "}
          — {m["mst.see"]()} <code className="font-mono">{surface.file}</code>.
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
      {/* Which node this is a picture of, worth knowing first: every knob below is on that module (docs/mastering.md). */}
      <p className="shrink-0 text-xs text-muted-foreground">
        {modules.length === 1 ? (
          <>
            {m["mst.module"]()} <code className="font-mono">{modules[0]}</code>
          </>
        ) : (
          <>
            {m["mst.drives"]({ n: modules.length })}{" "}
            {modules.map((mod) => (
              <code className="mr-1 font-mono" key={mod}>
                {mod}
              </code>
            ))}
            {m["mst.severalModules"]()}
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

      {/* Lines naming something the project has not got, reported rather than dropped: they are typos about the person's own project. */}
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
        {PART_LABEL[part]()}
      </h3>
      {has ? (
        <div className="flex flex-col gap-2">{children}</div>
      ) : (
        // Every part has a required control, so this is only reachable while the graph has not arrived or will not compile.
        <p className="text-xs text-muted-foreground">
          {m["mst.noneResolve"]()}
        </p>
      )}
    </section>
  );
}

/** One control: a slider in the param's own units, subscribed to ITS param alone, so the nine knobs that did not move end at `Object.is`. */
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
  /** The hand's value while a gesture is in flight — optimistic, and dropped as soon as the engine agrees. */
  const [held, setHeld] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (held !== undefined && engineAgrees(binding, held, live))
      setHeld(undefined);
  }, [binding, held, live]);

  const { min, max, step } = masterRange(binding);
  const { label, unit, home, choices } = binding.control;
  const value = shownValue(held, live) ?? Math.min(max, Math.max(min, home));
  // A CHOICE is a dropdown of named values, the slider being for a range (src/mastering/controls.ts).
  if (choices)
    return (
      <label className="flex items-center gap-2 text-xs">
        <span className="w-28 shrink-0 text-muted-foreground">{label()}</span>
        <select
          value={Math.round(value)}
          className="w-40 rounded border border-border bg-background px-1 py-0.5"
          onChange={(e) => {
            const v = Number(e.target.value);
            setHeld(v);
            onSet(binding.pluginId, binding.param, v);
          }}
        >
          {choices.map((c, i) => (
            <option key={c} value={i}>
              {c}
            </option>
          ))}
        </select>
      </label>
    );
  // A step of 1 or more is a whole number, anything finer keeps one decimal: a ceiling shown as '0 dB' when it is at −0.3 is a lie.
  const shown = step >= 1 ? Math.round(value) : value.toFixed(1);

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label()}</span>
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
