// The supervisor reports the library level its machine runs (`kLibraryLevel`, C++), and the editor
// reads it against LIBRARY_LEVEL: the two are one number written twice, so this keeps them equal
// without building the engine. See ../../../docs/library-versions-plan.md.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIBRARY_LEVEL } from "./libraryVersions";

const supervisor = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../engine/k7-supervisor/src/Supervisor.cpp",
);

describe("LIBRARY_LEVEL", () => {
  it("is the level the C++ supervisor reports", () => {
    const m = /constexpr int kLibraryLevel = (\d+);/.exec(
      readFileSync(supervisor, "utf8"),
    );
    expect(Number(m?.[1])).toBe(LIBRARY_LEVEL);
  });
});
