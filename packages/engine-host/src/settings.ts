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
  /** The engine-side file service's HTTP port. */
  filePort: number;
  /** The interfaces in the user's own order, best first: the first one PRESENT is where the engine goes. Absent names keep their rank, so replugging restores it. */
  audioPriority: string[];
  /** The media library's root, null meaning `~/.st0/mediatek`; hand-edited like the ports, and passed down as $STUDIO_MEDIATEK. */
  mediatekDir: string | null;
  /** The token this machine syncs its cache with, since a headless service has no cookie jar; the library's URL is derived, not stored. */
  mediatekToken: string | null;
  /**
   * The desktop app's own HTTP port — where it serves st0 and proxies what needs a server.
   * FIXED and persisted rather than ephemeral, and each reason is a bug you would meet: the
   * file service captures its CORS allowlist at SPAWN, `advertiseRegistry` writes a URL other
   * processes read, a second device has the address bookmarked, and a service worker's scope
   * is per-origin. See apps/st0-desktop/docs/server.md.
   */
  webPort: number;
  /**
   * Who this machine's workspaces belong to. Offline there is no OIDC to ask, and the file
   * service keys `~/.st0/root/<slug>` on an email — so one is REMEMBERED rather than
   * derived afresh, or a project would move house whenever the answer changed.
   * See apps/st0-desktop/docs/identity.md.
   */
  identity: string | null;
  /**
   * The libraries repository, for a machine with NO server to hold it. pl8 owns the account's
   * pointer and wins whenever it can be asked; this is the fallback so shared modules work
   * offline — see apps/st0-desktop/docs/pl8Shim.md.
   */
  librariesUri: string | null;
  /** The studio server this machine is paired with, or null for a machine on its own. */
  serverUrl: string | null;
  /**
   * The bearer that stands in for a session against that server. The desktop page holds NO
   * cookie for it — the proxy attaches this, and only for a loopback caller. That is what
   * keeps the whole third-party-cookie and ITP class of problem out of the app.
   */
  serverToken: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  registryUrls: [],
  port: 8765,
  filePort: 8770,
  audioPriority: [],
  mediatekDir: null,
  mediatekToken: null,
  librariesUri: null,
  // Free against 8765/8770 (engine, file service), 8789/8795/8787/8080 (the hosted backends),
  // 5223 (vite) and 10350 (Tilt).
  webPort: 8780,
  identity: null,
  serverUrl: null,
  serverToken: null,
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
    filePort: port(raw.filePort, DEFAULT_SETTINGS.filePort),
    audioPriority: priority(raw),
    mediatekDir: str(raw.mediatekDir),
    mediatekToken: str(raw.mediatekToken),
    librariesUri: str(raw.librariesUri),
    webPort: port(raw.webPort, DEFAULT_SETTINGS.webPort),
    identity: str(raw.identity),
    serverUrl: str(raw.serverUrl),
    serverToken: str(raw.serverToken),
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
