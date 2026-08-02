// settings.ts — the supervisor's persisted settings (`~/.lanes/engine-tray.json`).
//
// Small and hand-editable on purpose: the ports are not exposed anywhere in the UI, so
// changing one means opening this file. Autostart is deliberately NOT stored here — the
// OS login item is the source of truth for that.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { lanesDir, settingsPath } from "@studio/engine-client/paths";

export interface Settings {
  /** The registry the user pinned via "Add web UI…". Overrides every other tier. */
  registryUrl: string | null;
  /** The engine's WebSocket port. */
  port: number;
  /** The engine-side file service's HTTP port. */
  filePort: number;
  /** The interface the user picked. Remembered so it can be RE-selected when it comes
   *  back: unplugging an interface makes the engine fall to whatever it can find, and
   *  replugging it should not require another trip to the menu. */
  audioDevice: string | null;
  /** Where to go when `audioDevice` isn't present (or nothing is selected at all).
   *  Typically the built-in output — the point is to never end up on no device. */
  audioFallback: string | null;
  /** The media library's root. null == `~/.lanes/mediatek`. Here rather than in the UI for
   *  the same reason the ports are: it is set once, on a machine whose media lives on a
   *  second drive, and never again. Passed down to the file service as $LANES_MEDIATEK. */
  mediatekDir: string | null;
  /** The hosted library this machine caches, e.g. https://media.studio.frediver.se.
   *  null == no sync; the local folder is then whatever is in it and nothing else. */
  mediatekUrl: string | null;
  /** A personal access token for it, minted from the library's own UI and pasted here.
   *  A headless service has no cookie jar, which is the whole reason the token exists. */
  mediatekToken: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  registryUrl: null,
  port: 8765,
  filePort: 8770,
  audioDevice: null,
  audioFallback: null,
  mediatekDir: null,
  mediatekUrl: null,
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
    registryUrl: str(raw.registryUrl),
    port: port(raw.port, DEFAULT_SETTINGS.port),
    filePort: port(raw.filePort, DEFAULT_SETTINGS.filePort),
    audioDevice: str(raw.audioDevice),
    audioFallback: str(raw.audioFallback),
    mediatekDir: str(raw.mediatekDir),
    mediatekUrl: str(raw.mediatekUrl),
    mediatekToken: str(raw.mediatekToken),
  };
}

export function saveSettings(s: Settings): void {
  try {
    mkdirSync(lanesDir(), { recursive: true });
    writeFileSync(settingsPath(), `${JSON.stringify(s, null, 2)}\n`, "utf8");
  } catch {
    /* unwritable home — the pick holds for this session and is lost on the next one,
       which is better than failing the click the user just made */
  }
}
