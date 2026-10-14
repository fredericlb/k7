// A fork into `@account` inherits the library module it extends, carries its panel, takes the
// project's refs along, and leaves the library untouched; forking twice keeps what the fork holds.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forkIntoAccount } from "./accountFork";
import { loadModuleRefs } from "./loader";
import { resolveModuleRef } from "./moduleResolve";
import { accountLibraryHome, libraryOf } from "./sharedFolders";
import { writeLibraries } from "./testSupport";

describe("forkIntoAccount", () => {
  let ws: string;
  let project: string;
  let lib: string;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-fork-"));
    project = join(ws, "song");
    mkdirSync(project, { recursive: true });
    lib = writeLibraries(ws);
    writeFileSync(
      join(lib, "modules", "audio/reverb", "ui.yaml"),
      "rows: []\n",
    );
    writeFileSync(
      join(project, "graph.yaml"),
      'modules:\n  verb: { extends: "@k7-core/audio/reverb" }\n',
    );
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("makes @account/<path> extend the library module, and points the project at it", () => {
    const r = forkIntoAccount(project, "@k7-core/audio/reverb");
    expect(r).toMatchObject({ ref: "@account/audio/reverb", created: true });
    expect(readFileSync(join(project, "graph.yaml"), "utf8")).toContain(
      '"@account/audio/reverb"',
    );
    expect(readFileSync(join(r.folder, "ui.yaml"), "utf8")).toBe("rows: []\n");
    expect(libraryOf(r.folder)?.name).toBe("account");
    // It inherits: the fork plays the library's plugin until it says otherwise.
    const resolved = resolveModuleRef(
      "@account/audio/reverb",
      loadModuleRefs(project),
    );
    expect(resolved?.plugin).toMatchObject({ name: "Big Reverb" });
    expect(
      existsSync(join(lib, "modules", "audio/reverb", "module.yaml")),
    ).toBe(true);
  });

  it("keeps what an earlier fork holds, and refuses what is no library module", () => {
    forkIntoAccount(project, "@k7-core/audio/reverb");
    const file = join(accountLibraryHome(), "modules/audio/reverb/module.yaml");
    writeFileSync(
      file,
      'extends: "@k7-core/audio/reverb"\nparams: { Mix: 0.2 }\n',
    );
    expect(forkIntoAccount(project, "@k7-core/audio/reverb").created).toBe(
      false,
    );
    expect(readFileSync(file, "utf8")).toContain("Mix: 0.2");
    expect(() => forkIntoAccount(project, "@k7-core/audio/nothing")).toThrow(
      /no such module/,
    );
    expect(() => forkIntoAccount(project, "@account/audio/reverb")).toThrow(
      /no module of the origin's libraries/,
    );
  });
});
