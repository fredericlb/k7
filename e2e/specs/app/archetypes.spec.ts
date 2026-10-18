// archetypes.spec.ts — every archetype the "New project" dialog offers scaffolds a project that compiles.
// Over HTTP, the way the dialog calls it.
import { expect, test } from "../../src/target.ts";

const WORKSPACE = "E2E-archetypes";
const SHAPES = ["arrangement", "mix", "video", "live", "live-video"] as const;

test.describe.configure({ mode: "serial" });

// Remade by the first test rather than a beforeAll: `k7` is a per-test fixture, and the tests run in order.
let fresh = false;

for (const shape of SHAPES) {
  test(`a new ${shape} project compiles`, async ({ k7 }) => {
    const files = await k7.files();
    if (!fresh) {
      await files.removeWorkspace(WORKSPACE);
      await files.createWorkspace(WORKSPACE);
      fresh = true;
    }
    const { project } = await files.createProject(
      WORKSPACE,
      shape,
      `${shape}.k7`,
    );
    await files.open(WORKSPACE, project);
    expect(await files.projectErrors(WORKSPACE)).toEqual({
      errors: [],
      diagnostics: [],
    });
    await files.engineDoc(WORKSPACE);
  });
}
