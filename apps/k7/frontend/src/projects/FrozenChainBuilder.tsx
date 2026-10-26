// FrozenChainBuilder.tsx — a frozen chain built on the home page, with no project open: its steps in
// order, each a library module, the engine it runs as and the values of its knobs. A step keeps only the
// values that were changed, so the module's own defaults still rule the rest. See ../../docs/frozenChains.md.

import { Button } from "@frediverse/ui/button";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "@frediverse/ui/icons";
import { Input } from "@frediverse/ui/input";
import type {
  ChainModule,
  ChainModuleParams,
  FrozenChainStep,
} from "@studio/web-protocol";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { type AccountFiles, accountFiles } from "./api";

const FIELD =
  "rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 text-sm";

/** A chain's name as the file service takes it: one path segment. */
export const FROZEN_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function StepCard({
  files,
  step,
  index,
  count,
  modules,
  onChange,
  onMove,
  onRemove,
}: {
  files: AccountFiles;
  step: FrozenChainStep;
  index: number;
  count: number;
  modules: ChainModule[];
  onChange: (s: FrozenChainStep) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const mod = modules.find((x) => x.ref === step.module);
  const [knobs, setKnobs] = useState<ChainModuleParams | null>(null);
  useEffect(() => {
    if (!step.module) return setKnobs(null);
    let live = true;
    void accountFiles
      .chainModuleParams(files, step.module, step.engine)
      .then((p) => live && setKnobs(p))
      .catch(() => live && setKnobs({ params: [] }));
    return () => {
      live = false;
    };
  }, [files, step.module, step.engine]);
  const categories = [...new Set(modules.map((x) => x.category))];
  return (
    <li className="rounded border border-neutral-800 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-6 text-muted-foreground text-xs tabular-nums">
          {index + 1}.
        </span>
        <select
          aria-label={m["frozen.module"]()}
          value={step.module}
          onChange={(e) =>
            onChange({ id: step.id, module: e.target.value, params: {} })
          }
          className={`${FIELD} min-w-0 flex-1`}
        >
          <option value="" disabled>
            {m["frozen.pickModule"]()}
          </option>
          {categories.map((c) => (
            <optgroup key={c} label={c}>
              {modules
                .filter((x) => x.category === c)
                .map((x) => (
                  <option key={x.ref} value={x.ref}>
                    {x.ref}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {mod && mod.engines.length > 0 && (
          <select
            aria-label={m["frozen.engine"]()}
            value={step.engine ?? mod.engine ?? ""}
            onChange={(e) =>
              onChange({ ...step, engine: e.target.value, params: {} })
            }
            className={FIELD}
          >
            {mod.engines.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1 text-muted-foreground text-xs">
          <input
            type="checkbox"
            checked={!!step.bypass}
            onChange={(e) => onChange({ ...step, bypass: e.target.checked })}
          />
          {m["frozen.bypass"]()}
        </label>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={index === 0}
          onClick={() => onMove(-1)}
          aria-label={m["frozen.up"]()}
        >
          <ArrowUp className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
          aria-label={m["frozen.down"]()}
        >
          <ArrowDown className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onRemove}
          aria-label={m["frozen.removeStep"]()}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {mod?.offline && (
        <p className="mt-2 text-muted-foreground text-xs">
          {m["frozen.offlineStep"]()}
        </p>
      )}
      {knobs === null && step.module ? (
        <Loader2 className="mt-2 size-3.5 animate-spin" />
      ) : (
        knobs &&
        knobs.params.length > 0 && (
          <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {knobs.params.map((p) => {
              const set = step.params[p.name];
              const value = typeof set === "number" ? set : p.value;
              const step01 = (p.max - p.min) / 100 || 0.01;
              return (
                <label key={p.name} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-24 truncate ${set === undefined ? "text-muted-foreground" : ""}`}
                    title={p.name}
                  >
                    {p.label}
                  </span>
                  <input
                    type="range"
                    min={p.min}
                    max={p.max}
                    step={step01}
                    value={value}
                    onChange={(e) =>
                      onChange({
                        ...step,
                        params: {
                          ...step.params,
                          [p.name]: Number(e.target.value),
                        },
                      })
                    }
                    className="min-w-0 flex-1"
                  />
                  <span className="w-12 text-right tabular-nums">
                    {value.toFixed(2)}
                  </span>
                </label>
              );
            })}
          </div>
        )
      )}
    </li>
  );
}

/** The builder: a new chain when `initial` has no name, else that chain of the account's. */
export function FrozenChainBuilder({
  files,
  modules,
  initial,
  onSaved,
  onCancel,
}: {
  files: AccountFiles;
  modules: ChainModule[];
  initial: { name: string; steps: FrozenChainStep[]; existing: boolean };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [steps, setSteps] = useState<FrozenChainStep[]>(initial.steps);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOk = FROZEN_NAME.test(name);
  const ready =
    nameOk && steps.length > 0 && steps.every((s) => s.module !== "");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await accountFiles.saveFrozenChain(files, name, steps);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const move = (i: number, by: -1 | 1) =>
    setSteps((all) => {
      const next = [...all];
      const [s] = next.splice(i, 1);
      if (s) next.splice(i + by, 0, s);
      return next;
    });

  return (
    <section className="space-y-3 rounded-lg border border-neutral-800 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          disabled={initial.existing}
          onChange={(e) => setName(e.target.value.trim())}
          placeholder={m["frozen.namePlaceholder"]()}
          aria-label={m["frozen.name"]()}
          className="max-w-64 font-mono"
        />
        <span className="font-mono text-muted-foreground text-xs">
          @account/{name || "…"}
        </span>
      </div>
      {name && !nameOk && (
        <p className="text-destructive text-xs">{m["frozen.badName"]()}</p>
      )}
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <StepCard
            // A step has no id until saved: its place is its identity while it is drafted.
            key={s.id ?? `new-${i}`}
            files={files}
            step={s}
            index={i}
            count={steps.length}
            modules={modules}
            onChange={(next) =>
              setSteps((all) => all.map((x, j) => (j === i ? next : x)))
            }
            onMove={(by) => move(i, by)}
            onRemove={() => setSteps((all) => all.filter((_, j) => j !== i))}
          />
        ))}
      </ol>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setSteps((all) => [...all, { module: "", params: {} }])}
      >
        <Plus className="size-3.5" /> {m["frozen.addStep"]()}
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {m["frozen.cancel"]()}
        </Button>
        <Button disabled={!ready || busy} onClick={() => void save()}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}{" "}
          {m["frozen.save"]()}
        </Button>
      </div>
    </section>
  );
}
