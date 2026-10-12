// status.ts — what the menu bar says on its own: one status line, a downloads line while one runs, the tooltip, the icon.
// A missing supervisor REPLACES the status rather than decorating it: there is nothing behind the green dot.

import type { Download, Snapshot } from "@studio/supervisor-host/hostProtocol";
import { isRunning, ownsRunning } from "./view.ts";

export type IconState =
  | { kind: "running" }
  | { kind: "stopped" }
  | { kind: "error" }
  | { kind: "loading"; frame: number };

/** The one being fetched and how far, how many wait behind it, or the first failure; null when there is nothing. */
export function downloadsLine(downloads: Download[]): string | null {
  const live = downloads.filter((d) => d.phase !== "failed");
  const d = live[0];
  if (d) {
    const more = live.length > 1 ? ` (+${live.length - 1} more)` : "";
    if (d.phase === "unpacking") return `↓ Unpacking ${d.label}…${more}`;
    const pct =
      d.total > 0 ? Math.min(100, Math.floor((d.received * 100) / d.total)) : 0;
    return `↓ Downloading ${d.label}… ${pct}%${more}`;
  }
  const failed = downloads[0];
  return failed ? `⚠ ${failed.label}: download failed` : null;
}

export function statusLine(snap: Snapshot, hostError: string | null): string {
  if (hostError) return `⚠ ${hostError}`;
  if (isRunning(snap))
    return `● Running${ownsRunning(snap) ? "" : " (adopted)"} · id ${snap.engineId.slice(0, 8)} · :${snap.enginePort}`;
  if (snap.status === "error") return `⚠ ${snap.error ?? "error"}`;
  return "○ Stopped";
}

export function tooltip(snap: Snapshot): string {
  if (isRunning(snap)) return "st0-engine — running";
  if (snap.status === "error") return "st0-engine — error";
  return "st0-engine — stopped";
}

/** Up but still scanning plugins or fetching an instrument: not ready yet, so the spinner. */
export function pending(snap: Snapshot): boolean {
  return (
    isRunning(snap) &&
    (snap.pluginCount === undefined ||
      snap.downloads.some((d) => d.phase !== "failed"))
  );
}

export function iconState(
  snap: Snapshot,
  hostError: string | null,
  frame: number,
): IconState {
  if (hostError || snap.status === "error") return { kind: "error" };
  if (pending(snap)) return { kind: "loading", frame };
  return isRunning(snap) ? { kind: "running" } : { kind: "stopped" };
}
