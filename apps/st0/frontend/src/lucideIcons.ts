// lucideIcons.ts — resolve a lucide icon by NAME at runtime, for the ones a person picks.
//
// The dynamic import buys deferred EXECUTION, not a smaller bundle: thirty components import
// lucide statically, so the bundler cannot split it out, and naming the namespace retains all
// ~1500 exports where tree-shaking kept forty. The build says so, every time
// (`INEFFECTIVE_DYNAMIC_IMPORT`). Left that way on purpose — a curated subset is a product
// decision, not a refactor. Measured numbers and the whole argument: docs/shell.md.

import type { ComponentType } from "react";
import { useEffect, useState } from "react";

export type IconComponent = ComponentType<{ className?: string }>;
export type IconSet = Record<string, IconComponent>;

let cache: IconSet | null = null;
let pending: Promise<IconSet> | null = null;

/** The whole set, loaded once. Repeat calls get the cache, or join the flight already in the air. */
export function loadIcons(): Promise<IconSet> {
  if (cache) return Promise.resolve(cache);
  pending ??= import("@frediverse/ui/icons").then((mod) => {
    const out: IconSet = {};
    // Components only: the module also exports helpers, an `icons` map and an alias per name — a picker offering `createLucideIcon` would be absurd.
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

/** The icon set for a component that draws user-chosen icons — a menu opened before the chunk lands draws labels and no icons, which is honest. */
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
