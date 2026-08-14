// The bench is a LIVE project, and a bench that already existed becomes one. The second half is
// the part worth a test: a bench's `project.yaml` is written ONCE (only the chain is rewritten
// on open), so without a migration every bench made before the field would keep opening with a
// timeline over the graph. See packages/song/docs/projectMode.md and apps/st0/docs/banc.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rootDir } from "@studio/engine-client/paths";
import { projectModeOf } from "@studio/song/projectMode";
import { benchProjectForChain } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureChainBench } from "./bench.ts";
import { slugify } from "./slug.ts";

const EMAIL = "someone@example.test";
const CHAIN = "chains/live/vocals";
const SOURCE = `# Voix live.\nmodules:\n  "@in": [ comp ]\n  comp: [ "@out" ]\n`;
/** Never fetched: the mount is laid out below, so `ensureLibraries` finds it and skips git. */
const LIBRARIES_URI = "git@example.test:studio/libraries.git";

let home: string;
let prevHome: string | undefined;

/** The bench's workspace — where both the library submodule and the project live. */
const benchRoot = (): string =>
  join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE);

/** The bench's folder for that chain, as the service lays it out. */
const benchDir = (): string => join(benchRoot(), benchProjectForChain(CHAIN));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-benchlive-home-"));
  prevHome = process.env.HOME;
  // Off the real machine: this writes a workspace, and the user's own is not a fixture.
  process.env.HOME = home;
  // The library submodule, laid out by hand where the file service would have cloned it.
  const chain = join(benchRoot(), "_libraries", CHAIN);
  mkdirSync(chain, { recursive: true });
  writeFileSync(join(chain, "chains.yaml"), SOURCE, "utf8");
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe("the bench's shape", () => {
  it("is live when it is generated", async () => {
    await ensureChainBench(EMAIL, CHAIN, LIBRARIES_URI);
    expect(projectModeOf(benchDir())).toBe("live");
  });

  it("becomes live when it already existed", async () => {
    // A bench as it was written before the field: the same header, one line short.
    const dir = benchDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "project.yaml"),
      `# Le banc d'essai des modules.\nproject:\n  name: "modules"\n  tempo: 120\n  mediatekBench: true\n`,
      "utf8",
    );

    await ensureChainBench(EMAIL, CHAIN, LIBRARIES_URI);
    expect(projectModeOf(dir)).toBe("live");

    const raw = readFileSync(join(dir, "project.yaml"), "utf8");
    // Rewritten as a DOCUMENT, not as text: the French header the scaffold wrote is still there,
    // and so is the marker that makes this the one project allowed to write to the catalogue.
    expect(raw).toContain("Le banc d'essai des modules");
    expect(raw).toContain("mediatekBench: true");
  });

  it("leaves a bench that is already live alone", async () => {
    // Idempotent because it runs on EVERY open — a rewrite per open would churn the file, and
    // with it anything watching the folder.
    await ensureChainBench(EMAIL, CHAIN, LIBRARIES_URI);
    const first = readFileSync(join(benchDir(), "project.yaml"), "utf8");
    await ensureChainBench(EMAIL, CHAIN, LIBRARIES_URI);
    expect(readFileSync(join(benchDir(), "project.yaml"), "utf8")).toBe(first);
  });
});
