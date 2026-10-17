// version.ts — the engine wire's version, which the engine, its supervisor and the server all state:
// the engine in `whoami`, the supervisor in its heartbeat and its tunnel's upgrade header. A machine
// that states none speaks 1, since none was released before the field. What bumps it is
// docs/version.md; the C++ twins are kEngineProtocol in two WireVersion.h, kept equal by version.test.ts.

/** The version this tree speaks. */
export const ENGINE_PROTOCOL = 1;

/** The oldest a server still serves: a tunnel below it is refused with a 426, and the picker says to update. */
export const MIN_ENGINE_PROTOCOL = 1;

/** The header a supervisor states its version in when it dials a tunnel. */
export const ENGINE_PROTOCOL_HEADER = "x-studio-engine-protocol";

/** A stated version as a number: anything but a positive integer, absent included, reads as 1. */
export function engineProtocolOf(v: unknown): number {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return Number.isSafeInteger(n) && (n as number) >= 1 ? (n as number) : 1;
}

/** Whether a machine stating `v` is below `min` and must be updated before this server serves it. */
export function engineOutdated(v: unknown, min = MIN_ENGINE_PROTOCOL): boolean {
  return engineProtocolOf(v) < min;
}
