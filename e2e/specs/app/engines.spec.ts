// engines.spec.ts — each built-in instrument engine of the @k7-core library reaches the engine as ITS plugin, and plays.
// The engine document is what proves the engine was picked; the clock rolling is all a spec sees of the sound.
import { FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { expect, test } from "../../src/target.ts";
import { play } from "../../src/transport.ts";
import { watchPage } from "../../src/watch.ts";

// The slice of @studio/engine-protocol's PluginDoc read here.
type PluginDoc = {
  id: string;
  type: string;
  faustDsp?: string;
  surgePatch?: string;
  rack?: { note: number; clip: string }[];
};
type EngineDoc = { tracks: { plugins: PluginDoc[] }[] };

type Engine = {
  // Each plugin id (`lane:node`) the doc must hold, and what that plugin must be.
  plugins: Record<string, (p: PluginDoc) => void>;
  lanes: string[];
  bug?: string;
};

const isType = (type: string) => (p: PluginDoc) => expect(p.type).toBe(type);
const isFaust = (p: PluginDoc) => {
  expect(p.type).toBe("Faust");
  expect(p.faustDsp).toBeTruthy();
};

const ENGINES: Record<string, Engine> = {
  "eurorack.k7": {
    lanes: ["lead", "bass", "bells"],
    plugins: {
      "lead:plaits": isType("mu-plaits"),
      "lead:grains": isType("mu-clouds"),
      "bass:braids": isType("mu-braids"),
      "bells:rings": isType("mu-rings"),
    },
  },
  // Surge links its own renamed copies of plaits, clouds and stmlib: both in one edit guards the clash (engine docs/surgePlugin.md).
  "eurorack-surge.k7": {
    lanes: ["lead", "chords"],
    plugins: {
      "lead:plaits": isType("mu-plaits"),
      "chords:pad": (p) => {
        expect(p.type).toBe("Surge XT");
        expect(p.surgePatch).toMatch(/Pads[\\/]Bell Pad\.fxp$/);
      },
    },
  },
  "faust.k7": {
    lanes: ["melody"],
    plugins: { "melody:wavetable": isFaust, "melody:ladder": isFaust },
  },
  "sampler.k7": {
    lanes: ["melody"],
    plugins: { "melody:sampler": (p) => expect(p.type).toMatch(/^sampler$/i) },
  },
  "library-rack.k7": {
    lanes: ["beat"],
    plugins: {
      "beat:kit": (p) => {
        expect(p.type).toBe("sampler");
        expect(p.rack?.map((s) => s.note)).toEqual([36, 38, 42]);
        for (const s of p.rack ?? []) expect(s.clip).toMatch(/naked_drums/);
      },
    },
  },
};

for (const [project, { plugins, lanes, bug }] of Object.entries(ENGINES)) {
  test(`${project} sends each node as its engine's plugin`, async ({ k7 }) => {
    test.fail(!!bug, bug);
    const files = await k7.files();
    await files.open(FIXTURES_WORKSPACE, project);
    const doc = (await files.engineDoc(FIXTURES_WORKSPACE)) as EngineDoc;
    const byId = new Map(
      doc.tracks.flatMap((t) => t.plugins).map((p) => [p.id, p]),
    );
    for (const [id, check] of Object.entries(plugins)) {
      const plugin = byId.get(id);
      expect(plugin, id).toBeDefined();
      if (plugin) check(plugin);
    }
  });

  test(`${project} plays`, async ({ k7 }) => {
    const page = await k7.open(`/@local/${FIXTURES_WORKSPACE}/${project}`);
    const watch = watchPage(page);
    await expect(
      page.getByRole("img", { name: "engine connected" }),
    ).toBeVisible({ timeout: 30_000 });
    for (const lane of lanes)
      await expect(
        page.getByRole("button", { name: `mute ${lane}`, exact: true }),
      ).toBeVisible();
    await play(page);
    // Hold long enough for a plugin that fails to build or load to surface as a page error rather than pass unheard.
    await page.waitForTimeout(2_000);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    watch.assertClean();
  });
}
