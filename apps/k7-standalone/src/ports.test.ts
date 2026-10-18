// The app's ports: free ones in its range, and the same ones again next launch, since the pages' storage hangs on the origin.
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { choosePorts, portsFile } from "./ports.ts";

const held: Server[] = [];
afterEach(() => {
  for (const s of held.splice(0)) s.close();
});

// A range unlikely to be busy on a test machine.
const RANGE = { first: 41_890, last: 41_899 };

describe("choosePorts", () => {
  it("picks two different ports in the range and records them", async () => {
    const root = mkdtempSync(join(tmpdir(), "k7-ports-"));
    const ports = await choosePorts(root, RANGE);
    expect(ports.k7).not.toBe(ports.engine);
    for (const p of [ports.k7, ports.engine]) {
      expect(p).toBeGreaterThanOrEqual(RANGE.first);
      expect(p).toBeLessThanOrEqual(RANGE.last);
    }
    expect(JSON.parse(readFileSync(portsFile(root), "utf8"))).toEqual(ports);
  });

  it("keeps last launch's ports while they are free, and moves off one that is taken", async () => {
    const root = mkdtempSync(join(tmpdir(), "k7-ports-"));
    const first = await choosePorts(root, RANGE);
    expect(await choosePorts(root, RANGE)).toEqual(first);
    await new Promise<void>((res) => {
      const s = createServer().listen(first.k7, "127.0.0.1", () => res());
      held.push(s);
    });
    const moved = await choosePorts(root, RANGE);
    expect(moved.k7).not.toBe(first.k7);
    expect(moved.engine).toBe(first.engine);
  });
});
