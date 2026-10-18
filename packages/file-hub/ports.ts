// ports.ts — a free loopback port, from a RANGE when the host names one (`STUDIO_PORT_RANGE=22000-23000`), else any.
// The desktop app confines every port it opens to its range; a bind is the only test, and a port can still be taken after it.
import { createServer } from "node:net";

/** How a host confines the loopback ports its processes open: an env var its children inherit. */
export const PORT_RANGE_ENV = "STUDIO_PORT_RANGE";
/** Ports the host promised to a process that has not bound them yet, as `22000,22001`: no child picks them. */
export const PORT_RESERVED_ENV = "STUDIO_PORT_RESERVED";

/** The reserved list in `spec`; a bad entry is dropped. */
export function parseReserved(spec: string | undefined): number[] {
  return (spec ?? "")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p <= 65535);
}

export interface PortRange {
  first: number;
  last: number;
}

/** `22000-23000` as a range; anything else, or an upside-down or out-of-bounds one, is null. */
export function parsePortRange(spec: string | undefined): PortRange | null {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(spec ?? "");
  if (!m) return null;
  const first = Number(m[1]);
  const last = Number(m[2]);
  if (first < 1 || last > 65535 || first > last) return null;
  return { first, last };
}

/** Whether `port` binds on `host` right now; 0 binds any, and the port it got is answered. */
function bindOn(host: string, port: number): Promise<number | null> {
  return new Promise((res) => {
    const s = createServer();
    s.once("error", () => res(null));
    s.listen(port, host, () => {
      const got = (s.address() as { port: number }).port;
      s.close(() => res(got));
    });
  });
}

/** Free on loopback AND on every interface: macOS lets 127.0.0.1 bind beside a 0.0.0.0 listener, which is how the engine listens. */
async function bind(port: number): Promise<number | null> {
  const got = await bindOn("127.0.0.1", port);
  if (got === null) return null;
  return (await bindOn("0.0.0.0", got)) === null ? null : got;
}

/** A free port: the first of `prefer` that binds, else the first free one of `range` in order, else any when no range is given. */
export async function freePort(
  range: PortRange | null = parsePortRange(process.env[PORT_RANGE_ENV]),
  prefer: number[] = [],
  exclude: number[] = parseReserved(process.env[PORT_RESERVED_ENV]),
): Promise<number> {
  // `exclude` is what this host chose but has not bound yet, so a second pick cannot land on it.
  const usable = (p: number) =>
    !exclude.includes(p) && (!range || (p >= range.first && p <= range.last));
  for (const p of prefer)
    if (p > 0 && usable(p) && (await bind(p)) !== null) return p;
  if (!range) {
    const any = await bind(0);
    if (any === null) throw new Error("no free loopback port");
    return any;
  }
  for (let p = range.first; p <= range.last; p++)
    if (usable(p) && (await bind(p)) !== null) return p;
  throw new Error(`no free port in ${range.first}-${range.last}`);
}
