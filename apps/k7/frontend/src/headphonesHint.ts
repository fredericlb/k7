// headphonesHint.ts — when a live input becomes AUDIBLE (monitored, and given a channel), say once
// per project that the speakers will feed it back: a laptop's own mic and speakers howl the moment
// they meet. Said at the gesture or on opening such a project, never refused. See ../docs/shell.md.

import type { WebGraph } from "@studio/graph-model";

/** A line that hands a live input a channel — the node card's pick. */
export const givesChannel = (line: string): boolean =>
  /^node param \S+ @channel \S/.test(line.trim());

/** Whether the graph holds an input that is monitored AND reaches a channel — the state that can feed back. */
export const hasAudibleInput = (g: Pick<WebGraph, "chains">): boolean =>
  Object.values(g.chains).some((c) =>
    c.use.some((s) => s.monitor === "on" && !!s.channel?.length),
  );

const KEY = "k7.headphonesHint";

/** True the first time for `project` in this browser, false after — storage that fails says true, since the hint is cheap. */
export function firstTimeFor(project: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
    if (seen.includes(project)) return false;
    localStorage.setItem(KEY, JSON.stringify([...seen, project].slice(-50)));
  } catch {
    // Private mode or blocked storage: show it, once per load at worst.
  }
  return true;
}
