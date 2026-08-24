// settings.ts — the supervisor's persisted settings (`~/.studio/engine-tray.json`).
//
// Small and hand-editable on purpose: the ports are not exposed anywhere in the UI, so
// changing one means opening this file. Autostart is deliberately NOT stored here — the
// OS login item is the source of truth for that.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { settingsPath, studioDir } from "@studio/engine-client/paths";

export interface Settings {
  /** The registries the user pinned via "Add web UI…", overriding every other tier; a LIST, because each service holds its own. */
  registryUrls: string[];
  /** The engine's WebSocket port. */
  port: number;
  /** The engine-side file service's HTTP port. */
  filePort: number;
  /** The interface the user picked, remembered so replugging it restores it with no trip back to the menu. */
  audioDevice: string | null;
  /** Where to go when `audioDevice` isn't present, typically the built-in output — the point is to never end up on no device. */
  audioFallback: string | null;
  /** The media library's root, null meaning `~/.studio/mediatek`; hand-edited like the ports, and passed down as $STUDIO_MEDIATEK. */
  mediatekDir: string | null;
  /** The token this machine syncs its cache with, since a headless service has no cookie jar; the library's URL is derived, not stored. */
  mediatekToken: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  registryUrls: [],
  port: 8765,
  filePort: 8770,
  audioDevice: null,
  audioFallback: null,
  mediatekDir: null,
  mediatekToken: null,
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

export function loadSettings(): Settings {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(settingsPath(), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return { ...DEFAULT_SETTINGS }; // absent or unreadable — defaults, written on first change
  }
  return {
    registryUrls: urls(raw),
    port: port(raw.port, DEFAULT_SETTINGS.port),
    filePort: port(raw.filePort, DEFAULT_SETTINGS.filePort),
    audioDevice: str(raw.audioDevice),
    audioFallback: str(raw.audioFallback),
    mediatekDir: str(raw.mediatekDir),
    mediatekToken: str(raw.mediatekToken),
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
