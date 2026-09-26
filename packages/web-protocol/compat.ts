// compat.ts — can THIS engine play THAT project: the share of the plugins the project needs its
// engine to host (internal ones and VSTs alike) that the engine's catalogue has. Browser-safe and
// dependency-free, like quality.ts and performance.ts, because it is scored in TWO places: the
// browser, against a catalogue it asked the engine for, and the file service on the engine's own
// machine, against that engine's scan (`/project-compat`). One formula for both.

/** One plugin a project asks its engine for, as authored: `format` lowercased ("internal", "vst3"…). */
export interface PluginNeed {
  format: string;
  name: string;
}

/** One entry of an engine's catalogue — `list-plugins`' and the scan's shape, trimmed to what matching reads. */
export interface CataloguePlugin {
  format: string;
  name: string;
  /** A built-in's xmlTypeName, which is how a module names it (`4osc`, where the catalogue says "4OSC"). */
  id?: string;
}

export interface Compatibility {
  /** 0–100: needs the engine has over needs the project has, floored so that only a full house reads 100. */
  score: number;
  missing: PluginNeed[];
}

const key = (format: string, name: string): string =>
  `${format.toLowerCase()}|${name.toLowerCase()}`;

/** Score one catalogue against one project's needs; a project needing nothing is 100 anywhere. */
export function compatibility(
  needs: PluginNeed[],
  catalogue: CataloguePlugin[],
): Compatibility {
  const have = new Set<string>();
  for (const p of catalogue) {
    have.add(key(p.format, p.name));
    // A built-in answers to its type name too, which is what a module authors.
    if (p.id && p.format.toLowerCase() === "internal")
      have.add(key(p.format, p.id));
  }
  const wanted = new Map<string, PluginNeed>();
  for (const n of needs) wanted.set(key(n.format, n.name), n);
  if (!wanted.size) return { score: 100, missing: [] };
  const missing = [...wanted].filter(([k]) => !have.has(k)).map(([, n]) => n);
  return {
    score: Math.floor(((wanted.size - missing.length) / wanted.size) * 100),
    missing,
  };
}
