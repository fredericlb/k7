// lucideIcons.ts — resolve a lucide icon by NAME, at runtime.
//
// Naming one costs the whole set: everywhere else in this app picks its icons by import and is
// tree-shaken down to those, while "whatever the person chose" cannot be known at build time. The
// set is loaded through a dynamic import and cached, so a surface asking for an icon awaits once
// and every surface after it is synchronous.
//
// THE SPLIT DOES NOT HAPPEN, and the build says so: `INEFFECTIVE_DYNAMIC_IMPORT — lucide-react is
// dynamically imported by src/lucideIcons.ts but also statically imported by src/App.tsx, …`.
// Thirty components import their icons by name from the same module, so the bundler cannot move it
// into a chunk of its own; the `import()` buys deferred EXECUTION and no deferred download. Worse,
// naming the namespace retains all ~1500 exports where tree-shaking used to keep the forty this app
// draws. Measured: the IconPicker chunk is 1 KB and the main chunk is 2.4 MB.
//
// Left as it is because the ask was a complete library, and the alternative — a curated subset,
// statically imported — is a different product decision, not a refactor. See docs/shell.md.

import type { ComponentType } from "react";
import { useEffect, useState } from "react";

export type IconComponent = ComponentType<{ className?: string }>;
export type IconSet = Record<string, IconComponent>;

let cache: IconSet | null = null;
let pending: Promise<IconSet> | null = null;

/** The whole set, loaded once. Repeat calls get the cache, or join the flight already in the air. */
export function loadIcons(): Promise<IconSet> {
  if (cache) return Promise.resolve(cache);
  pending ??= import("lucide-react").then((mod) => {
    const out: IconSet = {};
    // Components only: the module also exports helpers, an `icons` map and an alias per name
    // ending in "Icon". A picker offering `createLucideIcon` would be absurd.
    for (const [name, v] of Object.entries(mod as Record<string, unknown>))
      if (
        /^[A-Z]/.test(name) &&
        !name.endsWith("Icon") &&
        (typeof v === "function" || (v && typeof v === "object"))
      )
        out[name] = v as IconComponent;
    cache = out;
    return out;
  });
  return pending;
}

/** What is loaded right now — null until it is. Synchronous, for a render that cannot await. */
export const iconsNow = (): IconSet | null => cache;

/**
 * The icon set for a component that draws user-chosen icons.
 *
 * Starts the load on mount and re-renders once when it lands. A menu opened before the chunk
 * arrives draws its labels and no icons, which is the honest degradation: the label is what the
 * entry MEANS, and an icon is how you recognise it faster the second time.
 */
export function useIcons(): IconSet | null {
  const [icons, setIcons] = useState<IconSet | null>(iconsNow);
  useEffect(() => {
    if (icons) return;
    let live = true;
    void loadIcons().then((s) => {
      if (live) setIcons(s);
    });
    return () => {
      live = false;
    };
  }, [icons]);
  return icons;
}
