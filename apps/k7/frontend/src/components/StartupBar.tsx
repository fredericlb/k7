// StartupBar.tsx — the bottom bar while the open project is still on its way to being heard: an
// engine being looked for, the project copied to it, applied, warmed up. The project is drawn and
// editable the whole time; this only says what Play is waiting for. See ../../docs/shell.md.

import { GateProgress } from "@studio/project-shell/progress";
import type { EngineLoadPhase, EngineSyncState } from "@studio/web-protocol";
import { m } from "../paraglide/messages.js";

/** The step under way, or null when there is nothing left to wait for. */
export function startupStep({
  searching,
  hasEngine,
  load,
  sync,
  connecting,
}: {
  searching: boolean;
  hasEngine: boolean;
  load: EngineLoadPhase | null | undefined;
  sync: EngineSyncState | null;
  connecting: boolean;
}): { label: string; pct: number | null } | null {
  if (!hasEngine)
    return searching ? { label: m["startup.searching"](), pct: null } : null;
  if (load === "copying") {
    const measured = sync && sync.bytes > 0;
    return {
      label: m["engineLoad.copyingTitle"](),
      pct: measured
        ? Math.min(100, Math.round((sync.bytesDone / sync.bytes) * 100))
        : null,
    };
  }
  if (load === "applying")
    return { label: m["engineLoad.applyingTitle"](), pct: null };
  if (load === "warming")
    return { label: m["engineLoad.warmingTitle"](), pct: null };
  return connecting ? { label: m["startup.connecting"](), pct: null } : null;
}

/** Whether Play must wait for the project: it is still being copied, applied or warmed on the engine, and a Play sent now is dropped. */
export function projectLoading(
  load: EngineLoadPhase | null | undefined,
  frozen: boolean,
): boolean {
  return !frozen && load != null;
}

export function StartupBar(props: Parameters<typeof startupStep>[0]) {
  const step = startupStep(props);
  return step ? <GateProgress label={step.label} pct={step.pct} /> : null;
}
