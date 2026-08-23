// audioPolicy.ts — which interface the engine should be on: the one the user PICKED
// whenever it's present, else their configured fallback, else leave the engine alone.
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

/** Everything the audio submenu's contents depend on, `current` and the two settings included, so polling every 2s does not mean rebuilding. */
export function menuSignature(
  devices: AudioDevice[],
  preferred: string | null,
  fallback: string | null,
): string {
  const rows = devices
    .map((d) => `${d.name}|${d.deviceType}|${d.current}`)
    .sort();
  return `${rows.join(US)}${RS}${preferred ?? ""}${RS}${fallback ?? ""}`;
}

const has = (devices: AudioDevice[], name: string): boolean =>
  devices.some((d) => d.name === name);

/** The device the engine should switch to, or null when it is already where it belongs and nothing better is reachable. */
export function desiredSwitch(
  devices: AudioDevice[],
  preferred: string | null,
  fallback: string | null,
): string | null {
  if (!devices.length) return null; // the engine answered with nothing — don't thrash
  const current = devices.find((d) => d.current)?.name ?? null;

  // 1. The user's pick, if it's plugged in.
  if (preferred && has(devices, preferred))
    return current !== preferred ? preferred : null;

  // The fallback applies only when the pick is genuinely missing or was never made — never over a device someone is deliberately on.
  const pickMissing = !!preferred && !has(devices, preferred);
  if (pickMissing || (!preferred && current === null)) {
    if (fallback && has(devices, fallback) && current !== fallback)
      return fallback;
  }

  // 3. Leave it be.
  return null;
}
