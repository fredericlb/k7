// engineScanGate.ts — a project being LOADED that names an external plugin waits for the engine's
// plugin scan before it is sent: compiled earlier, it would go out without a plugin installed since
// the last scan. A built-in-only project never waits, and a scan that stalls or never answers lets
// the project go with its unscanned plugins reported missing, as before. See docs/engineLoad.md.

import type {
  PluginInfo,
  PluginScanStatus,
} from "@studio/engine-client/engineControl";
import { writeScanCopy } from "@studio/song/engineCatalogue";
import { namesExternalPlugin } from "@studio/song/externalPlugins";
import type { EngineScanState } from "@studio/web-protocol";
import { holdForScan, releaseScanHold } from "./engineLoad.ts";

/** No word from a running scan for this long, and it is taken for hung: one plugin's load is bounded at 23 s by the engine. */
export const SCAN_STALL_MS = 60_000;
/** However much it says, a scan held for longer than this lets the project go. */
export const SCAN_MAX_MS = 10 * 60_000;
/** An engine that has not answered `plugin-scan` by then is older than the question, and scans nothing at startup. */
export const SCAN_ASK_MS = 3_000;
/** How long a project that went on without its scan says so. */
const STALLED_SHOWN_MS = 30_000;
/** How long the catalogue the scan ended on is waited for, when its broadcast was missed. */
const CATALOGUE_MS = 5_000;

/** The slice of an engine link the gate needs, so it can be tested without a socket. */
export interface ScanLink {
  pluginScan: PluginScanStatus | null;
  askPluginScan(): void;
  listPlugins(): void;
  on(event: "pluginScan", fn: (s: PluginScanStatus) => void): unknown;
  on(event: "plugins", fn: (p: PluginInfo[]) => void): unknown;
  on(event: "close", fn: () => void): unknown;
  on(event: "engineError", fn: (m: string) => void): unknown;
  off(event: "pluginScan", fn: (s: PluginScanStatus) => void): unknown;
  off(event: "plugins", fn: (p: PluginInfo[]) => void): unknown;
  off(event: "close", fn: () => void): unknown;
  off(event: "engineError", fn: (m: string) => void): unknown;
}

interface Wait {
  project: string;
  link: ScanLink;
  status: PluginScanStatus | null;
  /** Ends the wait: listeners and timers gone, and nothing resent. */
  cancel(): void;
}

const waits = new Map<string, Wait>();
/** Per session, the scan given up on, by the version it was running under — not waited for again; `shown` when it stalled. */
const gaveUp = new Map<
  string,
  { link: ScanLink; version: number; at: number; shown: boolean }
>();
/** The answer per project folder, at the revision it was read. */
const classified = new Map<string, { rev: string; external: boolean }>();

/** Whether `dir` names an external plugin, read once per revision — it reads the whole project. */
function namesExternal(dir: string, rev: string): boolean {
  const hit = classified.get(dir);
  if (hit?.rev === rev) return hit.external;
  const external = namesExternalPlugin(dir);
  classified.set(dir, { rev, external });
  if (classified.size > 64)
    classified.delete(classified.keys().next().value as string);
  return external;
}

const versionOf = (link: ScanLink): number => link.pluginScan?.version ?? -1;

/** Whether `session`'s load of `project` waits for `link`'s scan; `resend` is called once it may go, the catalogue written first. */
export function scanHolds(
  session: string,
  project: string,
  rev: () => string,
  link: ScanLink,
  resend: () => void,
  now: () => number = Date.now,
): boolean {
  const held = waits.get(session);
  if (held && held.project === project && held.link === link) return true;
  // Another project or another engine: the old wait goes, and its hold with it, before this one is judged.
  if (held) {
    held.cancel();
    releaseScanHold(session);
  }
  // A link that keeps no scan state at all is no engine link — a test's stand-in — and holds nothing.
  if (link.pluginScan === undefined) return false;
  const given = gaveUp.get(session);
  if (given?.link === link && given.version === versionOf(link)) return false;
  if (link.pluginScan && !link.pluginScan.scanning) return false;
  if (!namesExternal(project, rev())) return false;
  begin(session, project, link, resend, now);
  return true;
}

function begin(
  session: string,
  project: string,
  link: ScanLink,
  resend: () => void,
  now: () => number,
): void {
  const since = now();
  let heardAt = since;
  let catalogue: PluginInfo[] | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const onScan = (s: PluginScanStatus): void => {
    wait.status = s;
    heardAt = now();
    if (!s.scanning) void finish("ended");
  };
  const onPlugins = (p: PluginInfo[]): void => {
    catalogue = p;
  };
  // The link went: the resend reaches whichever link the session dials next, which is judged afresh.
  const onClose = (): void => void finish("closed");
  // An engine older than the question answers it with an error, which says as much as silence, sooner.
  const onError = (m: string): void => {
    if (m.includes("plugin-scan") && !wait.status) void finish("silent");
  };
  const detach = (): void => {
    for (const t of timers) clearTimeout(t);
    link.off("pluginScan", onScan);
    link.off("plugins", onPlugins);
    link.off("close", onClose);
    link.off("engineError", onError);
    if (waits.get(session) === wait) waits.delete(session);
  };
  const wait: Wait = {
    project,
    link,
    status: link.pluginScan,
    cancel: detach,
  };
  // The scan ended, said nothing, stalled or lost its link; an ended one has its catalogue written before the project goes.
  const finish = async (
    why: "ended" | "silent" | "stalled" | "closed",
  ): Promise<void> => {
    if (waits.get(session) !== wait) return;
    detach();
    if (why === "silent" || why === "stalled") {
      gaveUp.set(session, {
        link,
        version: versionOf(link),
        at: now(),
        shown: why === "stalled",
      });
      if (why === "stalled")
        console.warn(
          `   ⚠ the engine's plugin scan did not finish — opening without it`,
        );
    } else if (why === "ended") {
      // The engine broadcasts the list before the end; asked for when that frame was missed.
      const list = catalogue ?? (await askCatalogue(link));
      try {
        if (list) writeScanCopy(list);
      } catch (e) {
        console.error(`   ✗ could not write the scan: ${(e as Error).message}`);
      }
    }
    if (releaseScanHold(session)) resend();
  };
  waits.set(session, wait);
  holdForScan(session);
  link.on("pluginScan", onScan);
  link.on("plugins", onPlugins);
  link.on("close", onClose);
  link.on("engineError", onError);
  if (!link.pluginScan) {
    link.askPluginScan();
    timers.push(
      setTimeout(() => {
        if (!wait.status) void finish("silent");
      }, SCAN_ASK_MS),
    );
  }
  // One clock for both bounds: no word for a minute, or ten minutes in all.
  const tick = (): void => {
    const t = now();
    if (t - heardAt > SCAN_STALL_MS || t - since > SCAN_MAX_MS)
      void finish("stalled");
    else timers.push(setTimeout(tick, 1_000));
  };
  timers.push(setTimeout(tick, 1_000));
}

/** The catalogue asked for once, or null when the engine says nothing in time. */
function askCatalogue(link: ScanLink): Promise<PluginInfo[] | null> {
  return new Promise((resolve) => {
    const onPlugins = (p: PluginInfo[]): void => {
      clearTimeout(timer);
      link.off("plugins", onPlugins);
      resolve(p);
    };
    const timer = setTimeout(() => {
      link.off("plugins", onPlugins);
      resolve(null);
    }, CATALOGUE_MS);
    link.on("plugins", onPlugins);
    link.listPlugins();
  });
}

/** What the /workspace poll says of `session`'s scan: the one it waits for, the one it gave up on lately, or null. */
export function engineScanOf(
  session: string,
  now: number = Date.now(),
): EngineScanState | null {
  const w = waits.get(session);
  if (w) {
    const s = w.status;
    return {
      done: s?.done ?? 0,
      total: s?.total ?? 0,
      current: s?.current ?? "",
    };
  }
  const given = gaveUp.get(session);
  if (given?.shown && now - given.at < STALLED_SHOWN_MS)
    return { done: 0, total: 0, current: "", stalled: true };
  return null;
}

/** Drop `session`'s wait without sending anything — it was unloaded, or another project took the load. */
export function forgetScanWait(session: string): void {
  waits.get(session)?.cancel();
}
