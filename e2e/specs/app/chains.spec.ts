// chains.spec.ts — the Chains view edits the graph: a module added on a cable is wired in, a preset switches a node's base.
// Each edit is read back from disk and taken back by `project undo`; chains-edit.k7 is put back before every test.
import type { Locator, Page } from "@playwright/test";
import { runCommand } from "../../src/commandBar.ts";
import { expectFile, readFile, restoreProject } from "../../src/disk.ts";
import { FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { navControl } from "../../src/nav.ts";
import { expect, test } from "../../src/target.ts";
import { watchPage } from "../../src/watch.ts";

const WS = FIXTURES_WORKSPACE;
const PROJECT = "chains-edit.k7";
const GRAPH = `${PROJECT}/graph.k7x`;
const SYNTH_NODE = `${PROJECT}/nodes/pad.k7x`;
const SYNTH_MODULE = "@k7-core/instruments/synth/surge-xt";
const EFFECT = "tremolo";

type Point = { x: number; y: number };

test.beforeEach(async ({ k7 }) => {
  await restoreProject(await k7.files(), WS, PROJECT);
});

async function openChains(k7: {
  open(path: string): Promise<Page>;
}): Promise<Page> {
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    { timeout: 30_000 },
  );
  await (await navControl(page, "Chains")).click();
  return page;
}

/** A card of the canvas, named "node (module)" or just its name: a button while zoomed out, a group once its panel is drawn. */
const card = (page: Page, name: string): Locator =>
  page
    .getByRole("main")
    .getByRole("button", { name, exact: true })
    .or(page.getByRole("main").getByRole("group", { name, exact: true }));

async function centre(of: Locator): Promise<Point> {
  const box = await of.boundingBox();
  if (!box) throw new Error("the card is not drawn");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The `+` on the cable from `from` to `to`, a button hidden until it is hovered or focused. */
const cablePlus = (page: Page, from: string, to: string): Locator =>
  page.getByRole("button", {
    name: `Add a module between ${from} and ${to}`,
    exact: true,
  });

/** Picks EFFECT on the MIX → OUT cable and waits for it on disk; returns the new node's id and graph.k7x as it was. */
async function pickOnCable(
  page: Page,
): Promise<{ node: string; before: string }> {
  const mix = card(page, "MIX");
  const out = card(page, "OUT");
  await expect(mix).toBeVisible();
  await expect(out).toBeVisible();
  const before = await readFile(page, WS, GRAPH);

  // Enter on the focused `+` is what a keyboard does, and needs no pointer on a cable drawn in SVG.
  const plus = cablePlus(page, "MIX", "OUT");
  await plus.focus();
  await plus.press("Enter");
  const picker = page.getByRole("menu");
  await picker.getByRole("textbox", { name: "search modules…" }).fill(EFFECT);
  await picker
    .getByRole("menuitem", { name: new RegExp(`^${EFFECT}\\b`) })
    .first()
    .click();

  // The new node takes MIX's place before OUT: MIX feeds it, it feeds OUT.
  const graph = await expectFile(page, WS, GRAPH, (t) =>
    new RegExp(`MIX: \\["([\\w-]*${EFFECT}[\\w-]*)"\\]`).test(t),
  );
  const node = (graph.match(/MIX: \["([^"]+)"\]/) as RegExpMatchArray)[1];
  expect(graph).toMatch(new RegExp(`${node}: \\["OUT"\\]`));
  await expectFile(page, WS, `${PROJECT}/nodes/${node}.k7x`, (t) =>
    t.includes(`/audio/${EFFECT}`),
  );
  await expect(
    card(page, `${node} (${EFFECT})`).or(card(page, EFFECT)).first(),
  ).toBeVisible();
  return { node, before };
}

test("a library effect picked on the MIX → OUT cable is created and wired between them", async ({
  k7,
}) => {
  const page = await openChains(k7);
  const watch = watchPage(page);
  const { before } = await pickOnCable(page);
  expect(before).toMatch(/MIX: \["OUT"\]/);
  watch.assertClean();
});

test("one project undo takes a whole pick back: the node and its splice", async ({
  k7,
}) => {
  const page = await openChains(k7);
  const watch = watchPage(page);
  const { node, before } = await pickOnCable(page);
  await runCommand(page, "project undo");
  const undone = await expectFile(page, WS, GRAPH, (t) => !t.includes(node));
  expect(undone).toBe(before);
  watch.assertClean();
});

/** Zooms the canvas on `target` until its panel is drawn, which is when its preset dropdown exists. */
async function zoomOnto(page: Page, target: Locator, until: Locator) {
  const at = await centre(target);
  const box = await target.boundingBox();
  // The top of the card, where its header and the dropdown are, stays under the pointer as the camera zooms.
  await page.mouse.move(at.x, (box?.y ?? at.y) + 20);
  for (let i = 0; i < 10 && !(await until.isVisible()); i++) {
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(200);
  }
  await expect(until).toBeVisible();
}

test("a factory preset from the node's dropdown switches the Surge node's base, and undo restores it", async ({
  k7,
}) => {
  const page = await openChains(k7);
  const watch = watchPage(page);
  const synth = card(page, "pad (surge-xt)");
  await expect(synth).toBeVisible();
  const before = await readFile(page, WS, SYNTH_NODE);
  expect(before).not.toContain("base");

  const dropdown = page
    .getByRole("main")
    .getByRole("button", { name: /^preset(: |$)/ });
  await zoomOnto(page, synth, dropdown);
  await dropdown.click();
  const shelf = page.getByRole("menu");
  await expect(
    shelf.getByRole("textbox", {
      name: `search presets of ${SYNTH_MODULE}…`,
    }),
  ).toBeVisible();
  await shelf
    .getByRole("menuitem", { name: "Basses - Bass 2 k7-core", exact: true })
    .click();

  const after = await expectFile(page, WS, SYNTH_NODE, (t) =>
    /Basses\/Bass 2/.test(t),
  );
  expect(after).toContain(`extends("${SYNTH_MODULE}")`);

  // The engine is sent the patch the base names, not the library default.
  const files = await k7.files();
  const doc = (await files.engineDoc(WS)) as {
    tracks: { plugins: { surgePatch?: string }[] }[];
  };
  const patches = doc.tracks
    .flatMap((t) => t.plugins)
    .flatMap((p) => (p.surgePatch ? [p.surgePatch] : []));
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatch(/Basses[\\/]Bass 2\.fxp$/);

  await runCommand(page, "project undo");
  await expectFile(page, WS, SYNTH_NODE, (t) => t === before);
  watch.assertClean();
});
