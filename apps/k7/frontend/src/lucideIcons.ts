// lucideIcons.ts — resolve a lucide icon by NAME at runtime, for the ones a person picks.
//
// Through `@frediverse/ui/icons/all`, a module of its own, so the whole set is a chunk loaded on
// demand while the static `@frediverse/ui/icons` imports keep only the icons the code draws.
// Reading the `@frediverse/ui/icons` namespace here instead would put every icon on the first
// screen. See docs/shell.md and commons' docs/icons.md.

import type { ComponentType } from "react";
import { useEffect, useState } from "react";

export type IconComponent = ComponentType<{ className?: string }>;
export type IconSet = Record<string, IconComponent>;

let cache: IconSet | null = null;
let pending: Promise<IconSet> | null = null;

/** The whole set, loaded once. Repeat calls get the cache, or join the flight already in the air. */
export function loadIcons(): Promise<IconSet> {
  if (cache) return Promise.resolve(cache);
  pending ??= import("@frediverse/ui/icons/all").then((mod) => {
    const out: IconSet = {};
    // Components only, and one name each: a stray helper or a `…Icon` alias in a picker would be absurd.
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
  // A failed load is not cached: the next caller tries again rather than inheriting the rejection.
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

/** What is loaded right now — null until it is. Synchronous, for a render that cannot await. */
export const iconsNow = (): IconSet | null => cache;

/** The icon set for a component that draws user-chosen icons — a menu opened before the chunk lands draws labels and no icons, which is honest. */
export function useIcons(wanted = true): IconSet | null {
  const [icons, setIcons] = useState<IconSet | null>(iconsNow);
  useEffect(() => {
    // Nothing to draw, nothing to fetch: the whole set is a large chunk (docs/audit.md).
    if (icons || !wanted) return;
    let live = true;
    // A failure draws labels without icons, as before the chunk lands; the next mount asks again.
    loadIcons().then(
      (s) => {
        if (live) setIcons(s);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [icons, wanted]);
  return icons;
}
