// SidebarEngine.tsx — the engine selector at the foot of the home sidebar: which engine plays,
// a button to change it, and its figures right below. It shows the account's remembered engine,
// and a pick there is what the next project opens on; inside a project the selector is the project
// bar's engine slot instead (BarEngine.tsx), which shares its words. See ../../docs/shell.md.

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import { Loader2, TriangleAlert, Volume2, VolumeX } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { Compatibility } from "@studio/engine-browser/compat";
import { formatPerformance } from "@studio/web-protocol/performance";
import { formatLatency } from "@studio/web-protocol/quality";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { engines } from "../api";
import { m } from "../paraglide/messages.js";
import { usePopin } from "../popins";
import type { RankedEngine } from "../types";
import { EngineSelect } from "./EngineSelect";

/** What the selector shows and does — App's live session in the project bar, `HomeEngine`'s probe in the sidebar. */
export interface SidebarEngineProps {
  current: RankedEngine | null;
  /** The first engine is still being looked for. */
  searching: boolean;
  /** How compatible `current` is with the open project; under 100 draws a warning. */
  compat?: Compatibility | null;
  /** The engine's sound is played by this page rather than by its own machine. */
  audioToBrowser?: boolean;
  /** The figures under the name — the session's link in a project, the probe's elsewhere. */
  stats?: ReactNode;
  onChange: () => void;
}

const nameOf = (r: RankedEngine): string =>
  r.engine.hostname || r.engine.id.slice(0, 8);

/** What the selector says and shows, shared with the project bar's engine slot (BarEngine.tsx). */
export function engineWords({
  current,
  searching,
  compat,
  audioToBrowser = false,
}: Pick<
  SidebarEngineProps,
  "current" | "searching" | "compat" | "audioToBrowser"
>) {
  // Where the sound comes out, said in words: a laptop driving the desktop at home is otherwise silent with no reason given.
  const label = current
    ? audioToBrowser
      ? m["engineSwitch.soundHere"]()
      : m["engineSwitch.soundOn"]({ engine: nameOf(current) })
    : searching
      ? m["engines.searching"]()
      : m["engineSwitch.noSound"]();
  const hint = current
    ? audioToBrowser
      ? m["engineSwitch.hintHere"]({ engine: nameOf(current) })
      : m["engineSwitch.hint"]({ engine: nameOf(current) })
    : m["engineSwitch.noSoundHint"]();
  const incompatible =
    compat && compat.score < 100
      ? m["engineSwitch.incompatible"]({
          score: compat.score,
          missing: compat.missing.map((p) => p.name).join(", "),
        })
      : null;
  const Icon = current ? Volume2 : searching ? Loader2 : VolumeX;
  const icon = (
    <Icon
      className={cn(
        "h-4 w-4 shrink-0",
        !current && searching && "animate-spin",
        !current && !searching && "text-amber-500",
      )}
    />
  );
  return { label, hint, incompatible, icon };
}

/** The incompatibility triangle, beside the engine's name. */
export function EngineWarning({ text }: { text: string }) {
  return (
    <span
      className="flex shrink-0 text-amber-500"
      title={text}
      role="img"
      aria-label={text}
    >
      <TriangleAlert className="h-3.5 w-3.5" />
    </span>
  );
}

export function SidebarEngine({
  current,
  searching,
  compat,
  audioToBrowser = false,
  stats,
  onChange,
  folds = false,
}: SidebarEngineProps & {
  /** Below `sm` the sidebar folds to its icon rail, and the block to its icon, which opens the list. */
  folds?: boolean;
}) {
  const { label, hint, incompatible, icon } = engineWords({
    current,
    searching,
    compat,
    audioToBrowser,
  });
  return (
    <>
      {folds && (
        <Button
          variant="ghost"
          size="icon"
          className="mx-auto mb-1 sm:hidden"
          title={`${label} — ${hint}`}
          aria-label={m["engineSwitch.change"]()}
          onClick={onChange}
        >
          {icon}
        </Button>
      )}
      <section
        aria-label={m["engineSwitch.section"]()}
        className={cn(
          "mx-2 mb-2 flex-col gap-1.5 rounded-md border border-border p-2 text-xs",
          folds ? "hidden sm:flex" : "flex",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {icon}
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              current ? "text-foreground" : "text-muted-foreground",
            )}
            title={label}
          >
            {label}
          </span>
          {incompatible && <EngineWarning text={incompatible} />}
          <Button
            variant="secondary"
            size="xs"
            className="h-6 shrink-0 px-2"
            title={hint}
            onClick={onChange}
          >
            {m["engineSwitch.change"]()}
          </Button>
        </div>
        {stats && (
          <div className="flex min-w-0 items-center gap-1">{stats}</div>
        )}
      </section>
    </>
  );
}

// One probe shared by every home page for a little while: the sidebar remounts on each route, and a probe reaches every engine.
const PROBE_TTL_MS = 30_000;
let probe: {
  at: number;
  found: ReturnType<typeof engines.find>;
} | null = null;
const find = (fresh = false) => {
  if (fresh || !probe || Date.now() - probe.at > PROBE_TTL_MS)
    probe = { at: Date.now(), found: engines.find() };
  return probe.found;
};

/** The block on a home page: the account's remembered engine, its probed figures, and the list to choose another. */
export function HomeEngine() {
  const [ranked, setRanked] = useState<RankedEngine[]>([]);
  const [current, setCurrent] = useState<RankedEngine | null>(null);
  const [searching, setSearching] = useState(true);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  usePopin(picking, () => setPicking(false));

  // The remembered engine when it answered, else what the policy would take — what the next project opens on.
  const load = useCallback(async (fresh = false, prefer?: string) => {
    const { ranked: r, chosen, rememberedId } = await find(fresh);
    setRanked(r);
    const want = prefer ?? rememberedId;
    setCurrent(r.find((x) => x.engine.id === want) ?? chosen ?? null);
  }, []);

  useEffect(() => {
    void load()
      .catch(() => {})
      .finally(() => setSearching(false));
  }, [load]);

  const refresh = async (prefer?: string) => {
    setBusy(true);
    try {
      await load(true, prefer);
    } catch {
      // A probe that failed leaves the list as it was.
    } finally {
      setBusy(false);
    }
  };

  const stats = current ? (
    <>
      {current.latency ? (
        <Badge variant="default" title={current.latency.quality}>
          {formatLatency(current.latency)}
        </Badge>
      ) : (
        <Badge variant="amber">{m["engines.unreachable"]()}</Badge>
      )}
      {current.engine.performance && (
        <Badge variant="default">
          {formatPerformance(current.engine.performance)}
        </Badge>
      )}
    </>
  ) : null;

  return (
    <>
      <SidebarEngine
        current={current}
        searching={searching}
        stats={stats}
        folds
        onChange={() => {
          setPicking(true);
          void refresh();
        }}
      />
      {picking && (
        <div className="fixed inset-0 z-50 bg-background">
          <EngineSelect
            ranked={ranked}
            loading={busy}
            onRefresh={() => void refresh()}
            onPick={(r) => {
              // Remembered on the ACCOUNT: the next project opened, here or on another device, starts on it.
              engines.patchPrefs({ engineId: r.engine.id }).catch(() => {});
              probe = null;
              setCurrent(r);
              setPicking(false);
            }}
            onPaired={(id) => void refresh(id)}
            onBack={() => setPicking(false)}
            backLabel={m["common.close"]()}
          />
        </div>
      )}
    </>
  );
}
