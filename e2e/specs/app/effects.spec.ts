// effects.spec.ts — library effects, note transformers and a cold pass reach the engine as the plugins they compile to, and play.
// The engine document is the proof a module was sent; a cold module's measuring pass runs only under `clip process` (packages/song/docs/coldModules.md).
import { FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { expect, type K7, TARGET, test } from "../../src/target.ts";
import { play } from "../../src/transport.ts";
import { watchPage } from "../../src/watch.ts";

// The slice of @studio/engine-protocol's ProjectDoc read here.
type PluginDoc = {
  id: string;
  type: string;
  dspGraph?: string;
  params: Record<string, number>;
};
type EngineDoc = {
  masterPlugins: PluginDoc[];
  tracks: { id: string; plugins: PluginDoc[]; clips: { source: string }[] }[];
};

async function engineDoc(k7: K7, project: string): Promise<EngineDoc> {
  const files = await k7.files();
  await files.open(FIXTURES_WORKSPACE, project);
  return (await files.engineDoc(FIXTURES_WORKSPACE)) as EngineDoc;
}

/** The lane's plugins as `id type` lines, in chain order. */
const chainOf = (doc: EngineDoc, lane: string) =>
  doc.tracks
    .find((t) => t.id === lane)
    ?.plugins.map((p) => `${p.id} ${p.type}`) ?? [];

/** The parameter names a DSP or MIDI graph declares. */
const graphParams = (p: PluginDoc | undefined) =>
  (JSON.parse(p?.dspGraph ?? "{}") as { params?: { name: string }[] }).params
    ?.map((x) => x.name)
    .sort() ?? [];

const pluginOf = (doc: EngineDoc, id: string) =>
  doc.tracks.flatMap((t) => t.plugins).find((p) => p.id === id);

/** Opens the project, checks its lane is drawn, plays two seconds and stops with no page error. */
async function playsClean(k7: K7, project: string, lane: string) {
  const page = await k7.open(`/@local/${FIXTURES_WORKSPACE}/${project}`);
  const watch = watchPage(page);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(
    page.getByRole("button", { name: `mute ${lane}`, exact: true }),
  ).toBeVisible();
  await play(page);
  // Long enough for a plugin the engine failed to build to surface as a page error.
  await page.waitForTimeout(2_000);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  watch.assertClean();
}

test.describe("jsdsp effects", () => {
  test("chorus, phaser, overdrive and auto-wah are sent as DSP graphs", async ({
    k7,
  }) => {
    const doc = await engineDoc(k7, "jsdsp-fx.k7");
    expect(chainOf(doc, "melody")).toEqual([
      "melody:lead 4osc",
      "melody:chorus DSP Graph",
      "melody:phaser DSP Graph",
      "melody:drive DSP Graph",
      "melody:wah DSP Graph",
    ]);
    expect(graphParams(pluginOf(doc, "melody:chorus"))).toEqual([
      "Depth",
      "Speed",
      "Width",
    ]);
    expect(graphParams(pluginOf(doc, "melody:phaser"))).toEqual([
      "Depth",
      "Feedback",
      "Rate",
    ]);
    expect(graphParams(pluginOf(doc, "melody:drive"))).toEqual(["Amount"]);
    expect(graphParams(pluginOf(doc, "melody:wah")).length).toBeGreaterThan(0);
    // The chorus module's own `mix(0.5)` reaches the engine as its wet stage.
    expect(pluginOf(doc, "melody:chorus")?.params["@mix"]).toBe(0.5);
  });

  test("the jsdsp chain plays", async ({ k7 }) => {
    await playsClean(k7, "jsdsp-fx.k7", "melody");
  });
});

test.describe("Airwindows", () => {
  test("the leaves and the console channel ride the lane, the buss the master", async ({
    k7,
  }) => {
    const doc = await engineDoc(k7, "airwindows.k7");
    expect(chainOf(doc, "melody")).toEqual([
      "melody:lead 4osc",
      "melody:tape To Tape 5",
      "melody:chorus airwindows_chorus",
      "melody:channel Console 6 Channel",
    ]);
    expect(doc.masterPlugins.map((p) => p.type)).toContain("Console 6 Buss");
  });

  test("the Airwindows chain plays", async ({ k7 }) => {
    await playsClean(k7, "airwindows.k7", "melody");
  });
});

test.describe("note transformers", () => {
  test("arpeggiator, note repeat and transpose sit before the synth", async ({
    k7,
  }) => {
    const doc = await engineDoc(k7, "transformers.k7");
    expect(chainOf(doc, "melody")).toEqual([
      "melody:arp Arpeggiator",
      "melody:repeat MIDI Graph",
      "melody:transpose MIDI Graph",
      "melody:lead 4osc",
    ]);
    // The module's own params, among the pattern controls its graph also declares.
    expect(graphParams(pluginOf(doc, "melody:repeat"))).toEqual(
      expect.arrayContaining(["Count", "Division", "Gate"]),
    );
    expect(graphParams(pluginOf(doc, "melody:transpose"))).toEqual([
      "Semitones",
    ]);
  });

  test("the transformed notes play", async ({ k7 }) => {
    await playsClean(k7, "transformers.k7", "melody");
  });
});

test.describe("cold normalize", () => {
  const PROJECT = "cold-normalize.k7";

  test("an unmeasured normalizer is sent with Peak at 0 dBFS", async ({
    k7,
  }) => {
    const doc = await engineDoc(k7, PROJECT);
    expect(chainOf(doc, "drums")).toEqual(["drums:norm DSP Graph"]);
    // Unmeasured, the module can only attenuate: Target − 0 dB.
    expect(pluginOf(doc, "drums:norm")?.params).toMatchObject({
      Target: -6,
      Peak: 0,
    });
  });

  test("the unmeasured normalizer plays", async ({ k7 }) => {
    await playsClean(k7, PROJECT, "drums");
  });

  test("clip process measures the tone and bakes it at Target", async ({
    k7,
  }) => {
    // The phone has no ffmpeg, so its file service cannot measure a clip (engine/k7-runtime/docs/android.md).
    test.skip(TARGET === "android", "no ffprobe on a phone");
    const files = await k7.files();
    await files.open(FIXTURES_WORKSPACE, PROJECT);
    const peakOf = async () => {
      const { peak } = await files.waveform(FIXTURES_WORKSPACE, "tone", {
        whole: true,
      });
      return 20 * Math.log10(Math.max(...peak));
    };
    // The fixture's tone is a sine at −12 dBFS.
    expect(await peakOf()).toBeCloseTo(-12, 0);
    const body = await files.command(
      FIXTURES_WORKSPACE,
      "clip process tone drums",
    );
    expect(body.refused).toBeFalsy();
    expect(JSON.stringify(body.output)).toMatch(/clip tone now plays it/);
    const doc = (await files.engineDoc(FIXTURES_WORKSPACE)) as EngineDoc;
    const source = doc.tracks.find((t) => t.id === "drums")?.clips[0]?.source;
    expect(source).toMatch(/tone_drums_[^\\/]*\.wav$/);
    // Measured at −12 and normalised to Target −6: the bounce peaks at −6 dBFS.
    expect(await peakOf()).toBeCloseTo(-6, 0);
  });
});
