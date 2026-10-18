// jobSpelling.ts — a job frame's paths put in the tunnel's spelling before it reaches the machine:
// a shared root as the server names it, then `/` between the segments below it, whatever the
// server's own separator. Both path maps only recognise that form (pathMap.ts, PathMap.cpp), so a
// Windows server's `C:\…\.renders\x.wav` would otherwise reach a job unmapped and be refused.
// The one thing a reader would get wrong: on a `/` server this changes nothing at all.

import { sep as nativeSep } from "node:path";
import type { TunnelRoot } from "./frames.ts";

/** `path` in the tunnel's spelling when it lies under one of `roots` in the server's, else as it was. */
export function tunnelPath(
  path: string,
  roots: TunnelRoot[],
  sep: string = nativeSep,
): string {
  if (sep === "/") return path;
  for (const r of roots) {
    const head = `${r.remote}${sep}`;
    if (path.startsWith(head))
      return `${r.remote}/${path.slice(head.length).split(sep).join("/")}`;
  }
  return path;
}

/** Every string of a JSON frame through `tunnelPath`; a frame that is not JSON passes untouched. */
export function tunnelSpelling(
  text: string,
  roots: TunnelRoot[],
  sep: string = nativeSep,
): string {
  if (sep === "/" || roots.length === 0) return text;
  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch {
    return text;
  }
  // The longest root first, so a root inside another names the path by the nearer one.
  const byLength = [...roots].sort((a, b) => b.remote.length - a.remote.length);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return tunnelPath(v, byLength, sep);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x)]),
      );
    return v;
  };
  return JSON.stringify(walk(frame));
}
