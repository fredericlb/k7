// rules.ts — the decisions the settings screen makes, as plain functions. They came off the
// tray menu with the screen, and they are here rather than inline in a component for the same
// reason they were testable there: each one has a failure that LOOKS like working software.
// An enabled Stop on somebody else's engine. A green status over a dead file service. A
// plugin row whose id opens the wrong editor. See apps/studio-desktop/docs/settings.md.

import type {
  HostAudioDevice,
  HostSession,
  HostSnapshot,
} from "@studio/engine-host/hostProtocol";
import { SHOW_UI_SEP } from "@studio/engine-host/hostProtocol";
import type { DesktopState } from "../desktop";

export interface EngineActions {
  canStart: boolean;
  canStop: boolean;
  /** Why not, when not — a page has room for the sentence a greyed-out menu row never had. */
  reason?: string;
}

/**
 * THE safety rule: only an engine this supervisor spawned may be stopped or restarted. An
 * adopted one belongs to whoever started it, and killing it from here would reach into another
 * app's process.
 */
export function engineActions(state: DesktopState): EngineActions {
  const s = state.snapshot;
  const running = s?.status === "running";
  const owns = running && s?.ownsEngine === true;
  return {
    canStart: !running,
    canStop: owns,
    ...(running && !owns
      ? { reason: "this engine was started by another supervisor" }
      : {}),
  };
}

/** The status line. A missing supervisor REPLACES it: what the engine half believes is not the news. */
export function statusLine(state: DesktopState): string {
  if (state.hostError) return `⚠ ${state.hostError}`;
  const s = state.snapshot;
  if (!s || s.status === "stopped") return "Stopped";
  if (s.status === "error") return `⚠ ${s.error ?? "error"}`;
  const adopted = s.ownsEngine ? "" : " (adopted)";
  return `Running${adopted} · id ${s.engineId.slice(0, 8)} · :${s.enginePort}`;
}

/**
 * A dead file service is NOT a detail of a running engine: the engine is up and no browser can
 * reach a file, so calling that "running" and nothing else would be a lie.
 */
export function fileServiceWarning(s: HostSnapshot | null): string | undefined {
  return s?.fileServiceFailed
    ? "The file service is down: the engine is up but no browser can reach a file."
    : undefined;
}

/** The count arrives only after the scan, so silence is "scanning" rather than "none found". */
export function pluginsLine(state: DesktopState): string {
  const s = state.snapshot;
  const n = s?.pluginCount;
  if (n !== null && n !== undefined) return `Plugins: ${n}`;
  return s?.status === "running" ? "Plugins: scanning…" : "Plugins: —";
}

/** A device row. The remembered pick is marked only when the engine is NOT on it — that gap is what needs explaining. */
export function audioRow(
  d: HostAudioDevice,
  s: HostSnapshot,
): { label: string; detail: string } {
  const preferred = s.audioPreferred === d.name && !d.current;
  return {
    label: `${d.current ? "● " : "○ "}${d.name}`,
    detail: d.deviceType + (preferred ? " · preferred" : ""),
  };
}

/** A remembered pick that is not plugged in still gets a row, or the question has no answer on screen. */
export function missingDevice(s: HostSnapshot | null): string | null {
  if (!s?.audioPreferred) return null;
  return s.audioDevices.some((d) => d.name === s.audioPreferred)
    ? null
    : s.audioPreferred;
}

/** One session: which project, how big, and the two live facts ONLY when they are true. */
export function sessionRow(x: HostSession): { label: string; detail: string } {
  const who = x.id === "" ? "(default)" : x.id;
  const what = x.loaded
    ? ` · ${x.project === "" ? "untitled" : x.project} · ${x.tracks} track${x.tracks === 1 ? "" : "s"}`
    : " · nothing loaded";
  const live = [
    x.playing ? "playing" : null,
    x.listeners > 0 ? `${x.listeners} listening over the network` : null,
  ].filter(Boolean);
  return { label: `${who}${what}`, detail: live.join(" · ") };
}

/**
 * A plugin row's argument, forwarded VERBATIM. The separator is contract: the supervisor splits
 * on it, and any other one opens the wrong plugin's editor — or none — with no error at all.
 */
export function pluginArg(session: string, id: string): string {
  return `${session}${SHOW_UI_SEP}${id}`;
}

/** Built-ins have no native editor, so a row for one would open nothing. */
export function openablePlugins(s: HostSnapshot | null) {
  return (s?.editPlugins ?? []).filter((p) => p.hasNativePluginUI);
}

/** Qualify by session only when there is more than one — otherwise it is noise on every row. */
export function needsSessionPrefix(s: HostSnapshot | null): boolean {
  return new Set(openablePlugins(s).map((p) => p.session)).size > 1;
}
