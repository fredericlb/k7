// fixtures.spec.ts — every feature project under e2e/fixtures compiles on the server, and the broken ones say why.
// Over HTTP only: whether a project LOADS is the compiler's question; features.spec.ts asks what the screen draws.
import type { FileService } from "../../src/files.ts";
import { FIXTURES_WORKSPACE, fixtureProjects } from "../../src/fixtures.ts";
import { expect, test } from "../../src/target.ts";

const WS = FIXTURES_WORKSPACE;
// A fixture named broken-* must refuse to compile, with this text in the compiler's message.
const EXPECTED_ERROR: Record<string, RegExp> = {
  "broken-unresolved.k7": /does-not-exist/,
  "broken-sequence.k7": /sequence 'melody' failed to load/,
};

async function errorsOf(
  files: FileService,
  project: string,
): Promise<string[]> {
  await files.open(WS, project);
  return ((await files.projectErrors(WS)) as { errors: string[] }).errors;
}

for (const project of fixtureProjects()) {
  test(`${project} compiles`, async ({ k7 }) => {
    const files = await k7.files();
    const errors = await errorsOf(files, project);
    const expected = EXPECTED_ERROR[project];
    if (expected) {
      expect(errors.join("\n")).toMatch(expected);
      return;
    }
    expect(errors).toEqual([]);
    await files.engineDoc(WS);
  });
}

test("a sequence that fails its schema is reported by the schema's error", async ({
  k7,
}) => {
  const files = await k7.files();
  const errors = await errorsOf(files, "broken-sequence.k7");
  expect(errors.join("\n")).toMatch(
    /sequence 'melody' failed to load .*sequences\/melody\.k7x/,
  );
});
