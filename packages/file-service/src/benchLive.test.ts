// The bench is a LIVE project, and a bench that already existed becomes one. The second half is
// the part worth a test: a bench's `project.yaml` is written ONCE (only `modules/` is regenerated
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
import { BENCH_PROJECT } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureBench } from "./bench.ts";
import { slugify } from "./slug.ts";

const EMAIL = "someone@example.test";

let home: string;
let mediatek: string;
let prevHome: string | undefined;
let prevMediatek: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-benchlive-home-"));
  mediatek = mkdtempSync(join(tmpdir(), "td-benchlive-med-"));
  prevHome = process.env.HOME;
  prevMediatek = process.env.STUDIO_MEDIATEK;
  // Off the real machine: this writes a workspace, and the user's own is not a fixture.
  process.env.HOME = home;
  process.env.STUDIO_MEDIATEK = mediatek;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevMediatek === undefined) delete process.env.STUDIO_MEDIATEK;
  else process.env.STUDIO_MEDIATEK = prevMediatek;
  rmSync(home, { recursive: true, force: true });
  rmSync(mediatek, { recursive: true, force: true });
});

/** The module bench's folder, as the service lays it out. */
const benchDir = (): string =>
  join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE, BENCH_PROJECT);

describe("the bench's shape", () => {
  it("is live when it is generated", () => {
    ensureBench(EMAIL);
    expect(projectModeOf(benchDir())).toBe("live");
  });

  it("becomes live when it already existed", () => {
    // A bench as it was written before the field: the same header, one line short.
    const dir = benchDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "project.yaml"),
      `# Le banc d'essai des modules.\nproject:\n  name: "modules"\n  tempo: 120\n  mediatekBench: true\n`,
      "utf8",
    );

    ensureBench(EMAIL);
    expect(projectModeOf(dir)).toBe("live");

    const raw = readFileSync(join(dir, "project.yaml"), "utf8");
    // Rewritten as a DOCUMENT, not as text: the French header the scaffold wrote is still there,
    // and so is the marker that makes this the one project allowed to write to the catalogue.
    expect(raw).toContain("Le banc d'essai des modules");
    expect(raw).toContain("mediatekBench: true");
  });

  it("leaves a bench that is already live alone", () => {
    // Idempotent because it runs on EVERY open — a rewrite per open would churn the file, and
    // with it anything watching the folder.
    ensureBench(EMAIL);
    const first = readFileSync(join(benchDir(), "project.yaml"), "utf8");
    ensureBench(EMAIL);
    expect(readFileSync(join(benchDir(), "project.yaml"), "utf8")).toBe(first);
  });
});
