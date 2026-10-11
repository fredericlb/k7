// A library root's top-level folders are each a library's clone, and a clone may be a LINK (a dev's
// checkout): its files are served, while a link inside it pointing out of it is still refused — and a
// root without the flag keeps refusing the link itself.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statPaths } from "./hubFiles";

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "hubfiles-"));
  mkdirSync(join(base, "checkout", "wavetables"), { recursive: true });
  writeFileSync(join(base, "checkout", "wavetables", "basic.wav"), "RIFF");
  mkdirSync(join(base, "secret"));
  writeFileSync(join(base, "secret", "key"), "x");
  // A link INSIDE the clone, out of it.
  symlinkSync(join(base, "secret"), join(base, "checkout", "escape"));
  mkdirSync(join(base, "edits"));
  // The clone itself is a link, as a dev's library checkout is.
  symlinkSync(join(base, "checkout"), join(base, "edits", "st0"));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const root = (perChild: boolean) => ({
  remote: join(base, "edits"),
  name: "edits-x",
  writable: false,
  ...(perChild ? { perChild: true } : {}),
});

describe("a perChild root", () => {
  it("serves a file of a library clone that is a link", async () => {
    const [s] = await statPaths(
      [root(true)],
      [join(base, "edits", "st0", "wavetables", "basic.wav")],
    );
    expect(s.kind).toBe("file");
  });

  it("still refuses a link inside the clone that leads out of it", async () => {
    const [s] = await statPaths(
      [root(true)],
      [join(base, "edits", "st0", "escape", "key")],
    );
    expect(s.kind).toBe("missing");
  });

  it("is what makes the difference: a plain root refuses the linked clone", async () => {
    const [s] = await statPaths(
      [root(false)],
      [join(base, "edits", "st0", "wavetables", "basic.wav")],
    );
    expect(s.kind).toBe("missing");
  });
});
