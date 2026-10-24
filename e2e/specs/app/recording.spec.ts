// recording.spec.ts — arming a lane and recording a take, in the browser (a picture lane) and in the engine (an audio lane, a recorder node).
// A picture lane records the BROWSER's camera, faked by Chromium's launch flags; audio is the ENGINE's input device, which no flag fakes.
import type { Page } from "@playwright/test";
import type { FileService, TreeNode } from "../../src/files.ts";
import { expect, type K7, test } from "../../src/target.ts";
import { clockOf, transportBar } from "../../src/transport.ts";
import { watchPage } from "../../src/watch.ts";

const WORKSPACE = "E2E-recording";

test.describe.configure({ mode: "serial" });
// A new project is copied to the engine before Play is offered, which can take most of a minute.
test.setTimeout(120_000);

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/** Every file of the workspace, by path, through the file service's `/workspace-tree`. */
async function filesOf(files: FileService): Promise<string[]> {
  const out: string[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (!n.dir) out.push(n.path);
      if (n.children) walk(n.children);
    }
  };
  walk(await files.tree(WORKSPACE));
  return out;
}

/** The name of a take that appeared since `before` as bytes matching `take` AND the clip file declaring them. */
async function newTake(
  files: FileService,
  before: string[],
  take: RegExp,
): Promise<string> {
  let clip = "";
  await expect
    .poll(
      async () => {
        const all = await filesOf(files);
        const bytes = all.filter((f) => !before.includes(f) && take.test(f));
        const declared = bytes.find((f) =>
          all.includes(f.replace(/\.[^./]+$/, ".k7x")),
        );
        clip = declared?.replace(/^.*\/|\.[^./]+$/g, "") ?? "";
        return { bytes: bytes.length > 0, declared: !!declared };
      },
      { message: `no take matching ${take} was filed`, timeout: 20_000 },
    )
    .toEqual({ bytes: true, declared: true });
  return clip;
}

// Remade by the first test rather than a beforeAll: `k7` is a per-test fixture, and the tests run in order.
let fresh = false;
async function workspace(k7: K7): Promise<FileService> {
  const files = await k7.files();
  if (!fresh) {
    await files.removeWorkspace(WORKSPACE);
    await files.createWorkspace(WORKSPACE);
    fresh = true;
  }
  return files;
}

async function openProject(k7: K7, project: string): Promise<Page> {
  const page = await k7.open(`/@local/${WORKSPACE}/${project}`);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    { timeout: 30_000 },
  );
  return page;
}

/** Arms `lane`, turns record on, rolls a few seconds and stops, all from the transport bar. */
async function recordTake(page: Page, lane: string) {
  const arm = button(page, `arm ${lane}`);
  await arm.click();
  // Record pressed before the arm's echo arms "the only track" again, a toggle (fixed on worktree-e2e-regress).
  await expect(arm).toHaveAttribute("aria-pressed", "true");
  // Record once the project is playable: the load's dry run rolls in between, and its stop switches a younger record off.
  const play = button(page, "Play");
  await expect(play).toBeEnabled({ timeout: 90_000 });
  const record = button(page, "Record (arm + play records)");
  await record.click();
  await expect(record).toHaveAttribute("aria-pressed", "true");
  const before = await clockOf(page).innerText();
  await play.click();
  // The count-in comes first; a clock past it is a take being written.
  await expect(clockOf(page)).not.toHaveText(before, { timeout: 10_000 });
  await page.waitForTimeout(3_000);
  await transportBar(page)
    .getByRole("button", { name: "Stop", exact: true })
    .click();
}

test("a picture lane records the browser's camera onto itself", async ({
  k7,
}) => {
  const files = await workspace(k7);
  const { project } = await files.createProject(WORKSPACE, "video", "video.k7");
  const before = await filesOf(files);
  const page = await openProject(k7, project);
  const watch = watchPage(page);
  await recordTake(page, "main");
  // The take is declared as a clip beside its bytes, and placed on the lane it was armed on.
  const clip = await newTake(files, before, /\/clips\/main_[^/]+\.webm$/);
  await expect(page.getByText(clip, { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  watch.assertClean();
});

/** A song whose one lane is fed by the machine's first input channel. */
const INPUT_LANE: Record<string, string> = {
  "project.k7x":
    'project({\n  name: "input-lane",\n  tempo: 120,\n  sampleRate: 48000,\n  timeSignature: "4/4",\n  video: false,\n})\nmarkers({})\n',
  "graph.k7x": 'modules({ IN: ["vox"], vox: ["MIX"], MIX: ["OUT"] })\n',
  "nodes/IN.k7x": 'io("in")\nchannel([1])\nmonitor("off")\ngain(0)\n',
  "nodes/vox.k7x": 'extends("@meta/track")\nevents([])\n',
  "surfaces/timeline.k7x": 'type("timeline")\nlayout("split")\n',
};

test("an audio lane armed in the engine records a take from its input", async ({
  k7,
}) => {
  const files = await workspace(k7);
  const project = "input-lane.k7";
  for (const [path, text] of Object.entries(INPUT_LANE))
    await files.writeText(WORKSPACE, `${project}/${path}`, text);
  const before = await filesOf(files);
  const page = await openProject(k7, project);
  const watch = watchPage(page);
  await expect(button(page, "mute vox")).toBeVisible();
  await recordTake(page, "vox");
  // The engine writes the wav; the file service declares it as a clip and places it on the lane.
  const clip = await newTake(files, before, /\/clips\/vox[^/]*\.wav$/);
  expect(clip).toMatch(/^vox/);
  watch.assertClean();
});

test("a live rig's recorder node takes, times and clears a take", async ({
  k7,
}) => {
  const files = await workspace(k7);
  const { project } = await files.createProject(WORKSPACE, "live", "live.k7");
  const page = await openProject(k7, project);
  const watch = watchPage(page);
  // A card is named after its node, then its module: `recorder · step 1 (recorder)`.
  const card = page.getByRole("group", { name: /^recorder\b/ });
  // Framed, the card is drawn at the zoom that shows its face.
  await page.getByRole("button", { name: /^recorder\b/ }).dblclick();
  await expect(card.getByText("no record", { exact: true })).toBeVisible();
  // The engine holds the node once its load report says the node's ring is held: before that, Record is refused.
  await expect(card.getByTitle(/ · holds \d/)).toBeVisible({ timeout: 60_000 });
  const record = card.getByRole("button", { name: "Record", exact: true });
  await record.click();
  await expect(card.getByText("no record", { exact: true })).toBeHidden();
  await page.waitForTimeout(2_000);
  await record.click();
  // Stopped, the card shows the finished take's length, at least the two seconds held.
  await expect(card.getByText(/^0:0[2-9]\.\d$/)).toBeVisible({
    timeout: 5_000,
  });
  await card.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(card.getByText("no record", { exact: true })).toBeVisible();
  watch.assertClean();
});
