// enginePaths.ts — this process and the engine may not spell a path the same way. Under WSL
// the engine runs on the Windows host, so `/mnt/c/x` here is `C:\x` there, and a document
// carrying absolute paths would name files the engine cannot open — silently, since a missing
// source plays as silence rather than as an error. Gated on `$STUDIO_ENGINE_PATH_STYLE`;
// absent, there is no map and nothing is walked. See docs/wsl.md.

const MOUNT = /^\/mnt\/([a-z])(?=\/|$)/;
const DRIVE = /^([A-Za-z]):(?=[\\/]|$)/;

/** `/mnt/c/x/y` → `C:\x\y`; a string that is not under a drive mount comes back as it went. */
export function toWindowsPath(s: string): string {
  const m = MOUNT.exec(s);
  if (!m) return s;
  const rest = s.slice(m[0].length).replaceAll("/", "\\");
  return `${m[1].toUpperCase()}:${rest || "\\"}`;
}

/** The reverse, so a path the engine names round-trips back to the one we sent. */
export function toWslPath(s: string): string {
  const m = DRIVE.exec(s);
  if (!m) return s;
  const rest = s.slice(2).replaceAll("\\", "/");
  return `/mnt/${m[1].toLowerCase()}${rest.startsWith("/") ? rest : `/${rest}`}`;
}

export interface PathMap {
  out: (s: string) => string;
  back: (s: string) => string;
}

/** The map this process needs, or null when both ends already agree; read ONCE per frame, not per string. */
export function enginePathMap(): PathMap | null {
  return process.env.STUDIO_ENGINE_PATH_STYLE === "windows"
    ? { out: toWindowsPath, back: toWslPath }
    : null;
}

/** Rebuild a decoded frame with every string mapped; frames carry no cycles, being JSON. */
export function mapFrame<T>(v: T, f: (s: string) => string): T {
  if (typeof v === "string") return f(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => mapFrame(x, f)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = mapFrame(x, f);
    return out as unknown as T;
  }
  return v;
}
