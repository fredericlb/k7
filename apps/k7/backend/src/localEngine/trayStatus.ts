// trayStatus.ts — what the tray's icon and menu say, worded here so the Rust tray draws and decides nothing.
// Pure, so it is tested. See ../../docs/localEngine.md.

import type { Download } from "@studio/supervisor-host/hostProtocol";
import type { LocalEngineState } from "./host.ts";

export interface TrayStatus {
  /** The icon's badge. */
  icon: "stopped" | "loading" | "running" | "error";
  /** The menu's status line. */
  line: string;
  /** The second line while an instrument downloads, or null. */
  downloads: string | null;
}

/** The download being fetched and how far, how many wait behind it, or the first failure. */
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

export function trayStatus({ snapshot, down }: LocalEngineState): TrayStatus {
  if (down) return { icon: "error", line: `⚠ ${down}`, downloads: null };
  if (!snapshot)
    return { icon: "loading", line: "Starting the engine…", downloads: null };
  const downloads = downloadsLine(snapshot.downloads);
  if (snapshot.status === "error")
    return {
      icon: "error",
      line: `⚠ ${snapshot.error || "engine error"}`,
      downloads,
    };
  if (snapshot.status !== "running")
    return {
      icon: "stopped",
      line: snapshot.userStopped ? "○ Engine stopped" : "○ Engine starting…",
      downloads,
    };
  // Scanning plugins or fetching an instrument: up, but not ready to play yet.
  const busy = snapshot.pluginCount === undefined || downloads !== null;
  return {
    icon: busy ? "loading" : "running",
    line: `● Engine running · :${snapshot.enginePort}`,
    downloads,
  };
}
