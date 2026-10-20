// libraryRefusal.test.ts — a workspace asked for while the hub is still installing the bundled
// library waits for that copy, instead of being told an admin must add one.

import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LibraryNote } from "@studio/web-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryRefusal, NO_LIBRARIES } from "./libraries.ts";

const env = {
  home: process.env.STUDIO_LIBRARIES_HOME,
  hub: process.env.STUDIO_HUB_URL,
};
let home: string;
let hub: Server | null = null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "libs-"));
  process.env.STUDIO_LIBRARIES_HOME = home;
  delete process.env.STUDIO_HUB_URL;
});

afterEach(() => {
  hub?.close();
  hub = null;
  process.env.STUDIO_LIBRARIES_HOME = env.home;
  if (env.hub) process.env.STUDIO_HUB_URL = env.hub;
  else delete process.env.STUDIO_HUB_URL;
});

/** A hub whose ensure takes `ms`, then runs `act` and answers `notes`. */
async function slowHub(
  ms: number,
  act: () => void,
  notes: LibraryNote[],
): Promise<void> {
  hub = createServer((req, res) => {
    req.resume();
    req.on("end", () =>
      setTimeout(() => {
        act();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ notes }));
      }, ms),
    );
  });
  await new Promise<void>((ok) => hub?.listen(0, "127.0.0.1", ok));
  const { port } = hub.address() as AddressInfo;
  process.env.STUDIO_HUB_URL = `http://127.0.0.1:${port}`;
}

describe("libraryRefusal", () => {
  it("lets a workspace through at once when a library is there", async () => {
    mkdirSync(join(home, "k7-core"));
    expect(await libraryRefusal()).toBeNull();
  });

  it("waits for the hub's copy of the bundled library rather than refusing", async () => {
    await slowHub(150, () => mkdirSync(join(home, "k7-core")), [
      { name: "k7-core", state: "seeded", note: "copied" },
    ]);
    expect(await libraryRefusal()).toBeNull();
  });

  it("names the failed install, not an admin, when the copy failed", async () => {
    await slowHub(0, () => {}, [
      { name: "k7-core", state: "failed", note: "ENOSPC: no space left" },
    ]);
    expect(await libraryRefusal()).toEqual({
      status: 503,
      error:
        "the libraries could not be installed: 'k7-core': ENOSPC: no space left",
    });
  });

  it("still asks for an admin where the origin lists no library at all", async () => {
    await slowHub(0, () => {}, []);
    expect(await libraryRefusal()).toEqual({
      status: 400,
      error: NO_LIBRARIES,
    });
  });
});
