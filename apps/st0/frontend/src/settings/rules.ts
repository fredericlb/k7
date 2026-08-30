// rules.ts — the decisions the settings screen makes, as plain functions. They came off the
// tray menu with the screen, and they are here rather than inline in a component for the same
// reason they were testable there: each one has a failure that LOOKS like working software.
// An enabled Stop on somebody else's engine. A green status over a dead file service. A
// plugin row whose id opens the wrong editor. See apps/studio-desktop/docs/settings.md.

import { reorder } from "@studio/engine-host/audioPolicy";
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

export interface AudioRow {
  name: string;
  label: string;
  detail: string;
  /** Plugged in right now. An absent one still gets a row, or "why am I not on my interface?" has no answer on screen. */
  present: boolean;
  /** In the user's list, as opposed to merely visible. Only a ranked device is ever switched to. */
  ranked: boolean;
}

/**
 * Every interface worth a row, in the order the engine consults them: the user's ranking first,
 * then whatever else is plugged in. Moving any row sends this whole list back, so the first move
 * on a fresh machine ranks all of it at once — see apps/studio-desktop/docs/settings.md.
 */
export function audioRows(s: HostSnapshot): AudioRow[] {
  const byName = new Map(s.audioDevices.map((d) => [d.name, d]));
  const unranked = s.audioDevices
    .filter((d) => !s.audioPriority.includes(d.name))
    .map((d) => d.name);
  return [...s.audioPriority, ...unranked].map((name, i) => {
    const d = byName.get(name);
    const ranked = i < s.audioPriority.length;
    return {
      name,
      label: `${ranked ? `${i + 1}. ` : ""}${d?.current ? "● " : "○ "}${name}`,
      detail: rowDetail(d, ranked),
      present: d !== undefined,
      ranked,
    };
  });
}

function rowDetail(d: HostAudioDevice | undefined, ranked: boolean): string {
  if (!d) return "not connected — it keeps its place until you say otherwise";
  if (!ranked) return `${d.deviceType} · not ranked`;
  return d.current ? `${d.deviceType} · in use` : d.deviceType;
}

/** The list a move sends back: what the user could SEE, with one name shifted. `reorder` is the supervisor's, so both ends agree on what a move is. */
export function movedPriority(
  rows: AudioRow[],
  name: string,
  delta: number,
): string[] {
  return reorder(
    rows.map((r) => r.name),
    name,
    delta,
  );
}

/** Putting an unranked device into the list, where it sits on screen — which ranks the ones above it too, since a position means nothing without them. */
export function rankedPriority(rows: AudioRow[]): string[] {
  return rows.map((r) => r.name);
}

/** Forgetting one entry. Offered on an absent device only: a present one you demote is still on screen, where a name for hardware you sold is not. */
export function forgottenPriority(rows: AudioRow[], name: string): string[] {
  return rows.map((r) => r.name).filter((n) => n !== name);
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
