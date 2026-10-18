// archetypes.spec.ts — every archetype the "New project" dialog offers scaffolds a project that compiles.
// Over HTTP, the way the dialog calls it.
import { expect, test } from "@playwright/test";
import { FileService } from "../../src/files.ts";

const WORKSPACE = "E2E-archetypes";
const SHAPES = ["arrangement", "mix", "video", "live", "live-video"] as const;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const files = await FileService.connect(request);
  await files.removeWorkspace(WORKSPACE);
  await files.createWorkspace(WORKSPACE);
});

for (const shape of SHAPES) {
  test(`a new ${shape} project compiles`, async ({ request }) => {
    const files = await FileService.connect(request);
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
