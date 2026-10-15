// archetypes.spec.ts — every archetype the "New project" dialog offers scaffolds a project that compiles.
// Over HTTP, as the dialog calls it; wizard.spec.ts drives the dialog itself.
import { expect, test } from "@playwright/test";
import { FileService } from "../../src/files.ts";

const WORKSPACE = "E2E-archetypes";
const SHAPES = ["arrangement", "mix", "video", "live", "live-video"] as const;
// The mix scaffold extends @k7-core/audio/utility/* and filter/multimode, which k7-core keeps under zz_utility/ and filter/.
const KNOWN_BROKEN: Record<string, string> = {
  mix: "scaffoldSet.ts names library modules that are not there",
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const files = await FileService.connect(request);
  await files.removeWorkspace(WORKSPACE);
  await files.createWorkspace(WORKSPACE);
});

for (const shape of SHAPES) {
  test(`a new ${shape} project compiles`, async ({ request }) => {
    test.fail(shape in KNOWN_BROKEN, KNOWN_BROKEN[shape]);
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
