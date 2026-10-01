// nodeLoad.ts — what a card's corner says about what its plugin COSTS, from the state frame's load
// report: a share of the audio block and, for our own plugins, the buffers they hold. Pure text, so
// the rounding is tested and a frame that moves nothing does not re-render a card (docs/nodeCard.md).
// The one thing a reader would get wrong: the CPU is audio-thread time only, not the plugin's threads.

import type { PluginLoad } from "@studio/engine-protocol";

/** A byte count as a person reads it: KB, MB or GB, one decimal under ten. */
export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 && u > 0 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** The badge a card draws, or null for a plugin too cheap to mention — under 1 % and under 1 MB. */
export function loadBadge(
  l: PluginLoad | undefined,
): { text: string; title: string } | null {
  if (!l) return null;
  const pct = Math.round(l.cpu * 100);
  const big = l.bytes !== undefined && l.bytes >= 1024 * 1024;
  if (pct < 1 && !big) return null;
  const parts = [
    ...(pct >= 1 ? [`${pct}%`] : []),
    ...(big && l.bytes !== undefined ? [formatBytes(l.bytes)] : []),
  ];
  const title = [
    `CPU ${(l.cpu * 100).toFixed(1)}% of each audio block`,
    l.bytes !== undefined
      ? `holds ${formatBytes(l.bytes)}`
      : "memory: not reported by this plugin",
  ].join(" · ");
  return { text: parts.join(" · "), title };
}
