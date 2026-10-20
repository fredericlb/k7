// surge.spec.ts — a Surge XT node on its library default patch reaches the engine with that patch, and plays.
// The clock rolling is all a spec sees of the sound; the engine document is what proves the patch was sent (engine/k7-runtime/docs/surgePlugin.md).
import { FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { expect, test } from "../../src/target.ts";
import { play } from "../../src/transport.ts";
import { watchPage } from "../../src/watch.ts";

const PROJECT = "surge-synth.k7";
// The `base` @k7-core/instruments/synth/surge-xt plays when a node names none.
const DEFAULT_PATCH = /Pads[\\/]Bell Pad\.fxp$/;

// The slice of @studio/engine-protocol's ProjectDoc read here.
type EngineDoc = { tracks: { plugins: { surgePatch?: string }[] }[] };

test("a Surge node with no base is sent the library's default patch", async ({
  k7,
}) => {
  const files = await k7.files();
  await files.open(FIXTURES_WORKSPACE, PROJECT);
  const doc = (await files.engineDoc(FIXTURES_WORKSPACE)) as EngineDoc;
  const surge = doc.tracks
    .flatMap((t) => t.plugins)
    .filter((p) => p.surgePatch);
  expect(surge).toHaveLength(1);
  expect(surge[0].surgePatch).toMatch(DEFAULT_PATCH);
});

test("the Surge default patch plays", async ({ k7 }) => {
  const page = await k7.open(`/@local/${FIXTURES_WORKSPACE}/${PROJECT}`);
  const watch = watchPage(page);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole("button", { name: "mute chords", exact: true }),
  ).toBeVisible();
  await play(page);
  // Hold the chord long enough for a patch load to surface as a page error rather than pass unheard.
  await page.waitForTimeout(2_000);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  watch.assertClean();
});
