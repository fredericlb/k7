// settings.ts — the supervisor's persisted settings, `<state>/engine-host.json` and that name
// alone: the tray's `engine-tray.json` is no longer read — see engine-client/docs/paths.md.
//
// Small and hand-editable on purpose: the ports are not exposed anywhere in the UI, so
// changing one means opening this file. Autostart is deliberately NOT stored here — the
// OS login item is the source of truth for that.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  existingSettingsPath,
  settingsPath,
  studioDir,
} from "@studio/engine-client/paths";

export interface Settings {
  /** The st0 instances the user added in the tray, as their pl8 registries, overriding `$STUDIO_REGISTRY_URL`; a LIST, one per studio the engine is connected to. An older file may hold st0 URLs — read as their pl8. */
  registryUrls: string[];
  /** The engine's WebSocket port. */
  port: number;
  /** The interfaces in the user's own order, best first: the first one PRESENT is where the engine goes. Absent names keep their rank, so replugging restores it. */
  audioPriority: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  registryUrls: [],
  port: 8765,
  audioPriority: [],
};

// A hand-edited file is normal here, so each field is validated alone: one bad key must not lose the other four.
function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}
function port(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 65536
    ? v
    : fallback;
}

/** The registry list, also reading the singular `registryUrl` an older settings file carries: migration in the READER, the list winning. */
function urls(raw: Record<string, unknown>): string[] {
  const list = Array.isArray(raw.registryUrls)
    ? raw.registryUrls.filter(
        (v): v is string => typeof v === "string" && v !== "",
      )
    : [];
  if (list.length) return [...new Set(list)];
  const one = str(raw.registryUrl);
  return one ? [one] : [];
}

/** The order, also reading the `audioDevice` + `audioFallback` an older file carries: migration in the READER, exactly as `urls` does, and those two WERE a two-entry ranking. */
function priority(raw: Record<string, unknown>): string[] {
  const list = Array.isArray(raw.audioPriority)
    ? raw.audioPriority.filter(
        (v): v is string => typeof v === "string" && v !== "",
      )
    : [];
  if (list.length) return [...new Set(list)];
  const pair = [str(raw.audioDevice), str(raw.audioFallback)].filter(
    (v): v is string => v !== null,
  );
  return [...new Set(pair)];
}

export function loadSettings(): Settings {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(existingSettingsPath(), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return { ...DEFAULT_SETTINGS }; // absent or unreadable — defaults, written on first change
  }
  return {
    registryUrls: urls(raw),
    port: port(raw.port, DEFAULT_SETTINGS.port),
    audioPriority: priority(raw),
  };
}

export function saveSettings(s: Settings): void {
  try {
    mkdirSync(studioDir(), { recursive: true });
    writeFileSync(settingsPath(), `${JSON.stringify(s, null, 2)}\n`, "utf8");
  } catch {
    /* Unwritable home: the pick holds for this session only, rather than failing the click. */
  }
}
