// The port picker the desktop app confines itself with: a range, the ports to try first, and the ones already promised.
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { freePort, parsePortRange, parseReserved } from "./ports.ts";

const held: Server[] = [];
const hold = (port: number) =>
  new Promise<void>((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(port, "127.0.0.1", () => res());
    held.push(s);
  });
afterEach(() => {
  for (const s of held.splice(0)) s.close();
});

// A range unlikely to be busy on a test machine, and far from the app's own.
const RANGE = { first: 41_870, last: 41_879 };

describe("parsePortRange", () => {
  it("reads first-last, and refuses anything else", () => {
    expect(parsePortRange("22000-23000")).toEqual({
      first: 22000,
      last: 23000,
    });
    expect(parsePortRange(" 22000 - 23000 ")).toEqual({
      first: 22000,
      last: 23000,
    });
    for (const bad of [
      undefined,
      "",
      "22000",
      "23000-22000",
      "0-10",
      "1-70000",
    ])
      expect(parsePortRange(bad)).toBeNull();
  });
});

describe("freePort", () => {
  it("takes the first free port of the range, skipping one that is held", async () => {
    await hold(RANGE.first);
    expect(await freePort(RANGE)).toBe(RANGE.first + 1);
  });

  it("tries the preferred port first, but only inside the range", async () => {
    expect(await freePort(RANGE, [RANGE.first + 5])).toBe(RANGE.first + 5);
    expect(await freePort(RANGE, [RANGE.last + 100])).toBe(RANGE.first);
  });

  it("never answers a port already promised to another of the host's processes", async () => {
    expect(await freePort(RANGE, [RANGE.first], [RANGE.first])).toBe(
      RANGE.first + 1,
    );
  });

  it("counts a port held on every interface as taken, as the engine holds its own", async () => {
    await new Promise<void>((res, rej) => {
      const s = createServer();
      s.once("error", rej);
      s.listen(RANGE.first, "0.0.0.0", () => res());
      held.push(s);
    });
    expect(await freePort(RANGE)).toBe(RANGE.first + 1);
  });

  it("reads the reserved ports a host published", () => {
    expect(parseReserved("22000, 22001,nope,0")).toEqual([22000, 22001]);
    expect(parseReserved(undefined)).toEqual([]);
  });

  it("binds any port when no range is named", async () => {
    expect(await freePort(null)).toBeGreaterThan(0);
  });
});
