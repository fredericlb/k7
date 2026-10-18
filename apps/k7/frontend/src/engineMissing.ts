// engineMissing.ts — which engine warnings mean the project is playing WITHOUT something it names:
// a file the engine refused or could not open, a plugin it could not create. Read off the warning's
// text, since the engine sends no code for these; a wording it does not know is simply not counted.
// The one thing a reader would get wrong: these are not fatal — the project plays, a sound short.

/** One thing the project names that the engine is playing without. */
export interface MissingItem {
  /** What it is, in the engine's words: "rack sample", "clip", "plugin"… */
  what: string;
  /** The file's name, or the plugin's — never a whole path, which says nothing a person reads. */
  name: string;
  /** Why: the file is outside the folders the engine may open, it is not there, or the plugin is not installed. */
  why: "refused" | "not-found" | "not-installed";
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path;

// An external plugin's type is only its format, so its own name is what says which one is missing.
const FORMATS = new Set(["vst3", "vst", "au", "clap", "lv2"]);
const pluginName = (name: string, type: string): string =>
  FORMATS.has(type.toLowerCase()) && name ? name : type;

// Each wording the engine uses (engine/k7-runtime/server/DocJson.cpp, engine/EditBuilder.cpp, engine/FaustPlugin.cpp).
const RULES: [RegExp, (g: string[]) => MissingItem][] = [
  [
    /^(.+?) '(.+)' is outside the folders this engine reads/,
    (g) => ({ what: g[1], name: baseName(g[2]), why: "refused" }),
  ],
  [
    /^clip source not found\/invalid: (.+)$/,
    (g) => ({ what: "clip", name: baseName(g[1]), why: "not-found" }),
  ],
  [
    /^rack sound '.*' -> '(.+)' is missing or unreadable/,
    (g) => ({ what: "rack sample", name: baseName(g[1]), why: "not-found" }),
  ],
  [
    /^faust: no such sound file for '.*': (.+)$/,
    (g) => ({ what: "sound file", name: baseName(g[1]), why: "not-found" }),
  ],
  [
    /^plugin '(.*)' \((.+)\) is not in the cache/,
    (g) => ({
      what: "plugin",
      name: pluginName(g[1], g[2]),
      why: "not-installed",
    }),
  ],
  [
    /^could not create plugin '(.*)' \((.+)\)$/,
    (g) => ({
      what: "plugin",
      name: pluginName(g[1], g[2]),
      why: "not-installed",
    }),
  ],
];

/** The missing thing an engine warning reports, or null when the warning is about something else. */
export function missingOf(message: string): MissingItem | null {
  for (const [re, item] of RULES) {
    const g = re.exec(message);
    if (g) return item(g);
  }
  return null;
}

/** A stable key for one item, so the same file named by two tracks is listed once. */
export const missingKey = (i: MissingItem): string =>
  `${i.why}\u0000${i.what}\u0000${i.name}`;
