// audioPolicy.ts — which interface the engine should be on: the user's list in THEIR order,
// best first, and the first entry actually plugged in wins. There is no default and no
// fallback any more — a fallback was only ever the second line of this list.
// Kept apart from the loop that calls it so the rules stay testable without a running
// engine. Full rationale: docs/supervisorPolicy.md.

// The shape the engine reports, declared locally so the policy stays testable without the WebSocket client.
export interface AudioDevice {
  name: string;
  deviceType: string;
  current: boolean;
}

// The separators are control characters, so a device name can never forge one.
const US = "";
const RS = "";

/** A stable identifier for "the set of interfaces currently visible", used to decide when a switch that didn't take is worth re-attempting. */
export function signature(devices: AudioDevice[]): string {
  return devices
    .map((d) => d.name)
    .sort()
    .join(US);
}

/** Everything the audio rows depend on, `current` and the ranking included, so polling every 10s does not mean redrawing. */
export function menuSignature(
  devices: AudioDevice[],
  priority: string[],
): string {
  const rows = devices
    .map((d) => `${d.name}|${d.deviceType}|${d.current}`)
    .sort();
  // The ranking is joined IN ORDER, unsorted: a reorder that moved no membership is the whole point of this list.
  return `${rows.join(US)}${RS}${priority.join(US)}`;
}

/** The best-ranked interface that is actually there, or null when the user has ranked none of the visible ones. */
export function bestPresent(
  devices: AudioDevice[],
  priority: string[],
): string | null {
  return priority.find((n) => devices.some((d) => d.name === n)) ?? null;
}

/** The device the engine should switch to, or null when it is already where it belongs and nothing better is reachable. */
export function desiredSwitch(
  devices: AudioDevice[],
  priority: string[],
): string | null {
  if (!devices.length) return null; // the engine answered with nothing — don't thrash
  const want = bestPresent(devices, priority);
  // Nothing ranked is plugged in: leave the engine where it is, since a device we did not choose beats none.
  if (!want) return null;
  const current = devices.find((d) => d.current)?.name ?? null;
  return current === want ? null : want;
}

/**
 * The ranking after moving one name by `delta` places, unchanged when that would run off
 * either end. It is given the rows the user can SEE — the ranking plus any present device
 * missing from it — so the first move on a fresh install ranks the whole visible list.
 */
export function reorder(rows: string[], name: string, delta: number): string[] {
  const from = rows.indexOf(name);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  next.splice(from, 1);
  next.splice(to, 0, name);
  return next;
}
