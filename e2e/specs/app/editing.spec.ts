// editing.spec.ts — a value typed in the k7x editor reaches the screen and the disk, and the undo journal takes it back.
// The edit is the tempo of edit-undo.k7: one line of project.k7x, read as "<n> bpm" in the footer, or the Info popover on a phone (packages/song-edit/docs).
import type { Page } from "@playwright/test";
import { commandBar, expectStatus, runCommand } from "../../src/commandBar.ts";
import { expectFile, readFile, restoreProject } from "../../src/disk.ts";
import { editorText, inVim, vimStatus } from "../../src/editor.ts";
import { FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { folded, navControl, tempoReadout } from "../../src/nav.ts";
import { expect, test } from "../../src/target.ts";
import { clockOf } from "../../src/transport.ts";
import { watchPage } from "../../src/watch.ts";

const WS = FIXTURES_WORKSPACE;
const PROJECT = "edit-undo.k7";
const PROJECT_FILE = `${PROJECT}/project.k7x`;
const SEQUENCE_NODE = `${PROJECT}/nodes/melody.k7x`;
const GRAPH_FILE = `${PROJECT}/graph.k7x`;

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

// Every test starts from the fixture as committed, whatever the one before it typed.
test.beforeEach(async ({ k7 }) => {
  await restoreProject(await k7.files(), WS, PROJECT);
});

// Editing needs no engine, only the compiled project: the lane drawn says it has loaded.
async function openProject(page: Page): Promise<void> {
  await expect(button(page, "mute melody")).toBeVisible({ timeout: 30_000 });
}

/** Opens project.k7x in the editor and retypes the tempo, in vim's keys when the editor is in vim mode (the account default). */
async function typeTempo(page: Page, tempo: number): Promise<void> {
  await (await navControl(page, "Editor")).click();
  // A phone folds the file tree into a drawer, opened by its "files" button (EditorTab.tsx).
  if (await folded(page)) {
    const files = button(page, "files");
    if ((await files.getAttribute("aria-expanded")) !== "true")
      await files.click();
  }
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "project.k7x", exact: true })
    .click();
  const text = editorText(page, "project.k7x");
  await expect(text).toContainText("tempo: 120");
  await text.click();
  if (await inVim(page)) {
    await page.keyboard.type("gg2j0f1ciw");
    await expect(vimStatus(page)).toHaveText("INSERT");
    await page.keyboard.type(String(tempo));
    await page.keyboard.press("Escape");
    await expect(vimStatus(page)).toHaveText("NORMAL");
    return;
  }
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Backspace");
  await page.keyboard.type(String(tempo));
}

/** Presses `key` until `settled` passes, three presses at most. */
async function pressUntil(
  page: Page,
  key: string,
  settled: () => Promise<void>,
): Promise<void> {
  for (let i = 1; ; i++) {
    await page.keyboard.press(key);
    try {
      await settled();
      return;
    } catch (e) {
      if (i === 3) throw e;
    }
  }
}

/** The lines of `after` that differ from `before`'s, by position: one entry for a one-line edit. */
function changedLines(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  expect(b).toHaveLength(a.length);
  return b.filter((line, i) => line !== a[i]);
}

test("a tempo typed in the editor shows in the footer and lands on disk as one line", async ({
  k7,
}) => {
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  const watch = watchPage(page);
  await openProject(page);
  const before = await readFile(page, WS, PROJECT_FILE);
  await typeTempo(page, 132);
  const after = await expectFile(page, WS, PROJECT_FILE, /tempo: 132,/);
  expect(changedLines(before, after)).toEqual(["  tempo: 132,"]);
  await expect(await tempoReadout(page, 132)).toBeVisible();
  watch.assertClean();
});

test("project undo takes the typed tempo back, project redo puts it again", async ({
  k7,
}) => {
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  const watch = watchPage(page);
  await openProject(page);
  const before = await readFile(page, WS, PROJECT_FILE);
  await typeTempo(page, 140);
  await expectFile(page, WS, PROJECT_FILE, /tempo: 140,/);
  await expect(await tempoReadout(page, 140)).toBeVisible();

  await runCommand(page, "project undo");
  await expect(
    page.getByRole("status").filter({ hasText: /^Undone: / }),
  ).toBeVisible();
  const undone = await expectFile(page, WS, PROJECT_FILE, /tempo: 120,/);
  expect(undone).toBe(before);
  await expect(await tempoReadout(page, 120)).toBeVisible();
  await expect(editorText(page, "project.k7x")).toContainText("tempo: 120");

  await runCommand(page, "project redo");
  await expect(
    page.getByRole("status").filter({ hasText: /^Redone: / }),
  ).toBeVisible();
  await expectFile(page, WS, PROJECT_FILE, /tempo: 140,/);
  await expect(await tempoReadout(page, 140)).toBeVisible();
  watch.assertClean();
});

test("Ctrl+Z in the editor spends the typing first, Ctrl+Y brings it back", async ({
  k7,
}) => {
  // Hardware-keyboard shortcuts; a phone undoes through the command bar, which the test before this one drives.
  test.skip(k7.target === "android", "no hardware keyboard on a phone");
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  const watch = watchPage(page);
  await openProject(page);
  await typeTempo(page, 150);
  await expectFile(page, WS, PROJECT_FILE, /tempo: 150,/);

  const text = editorText(page, "project.k7x");
  // Typed without vim, the tempo is several buffer steps, so a person presses until the old value is back.
  await pressUntil(page, "Control+z", () =>
    expect(text).toContainText("tempo: 120", { timeout: 1_000 }),
  );
  await expectFile(page, WS, PROJECT_FILE, /tempo: 120,/);
  await expect(await tempoReadout(page, 120)).toBeVisible();

  // With the typing spent, one more press only says so: the project journal waits for a second one.
  await page.keyboard.press("Control+z");
  // That answer is a status-line message, which a phone does not draw.
  if (!(await folded(page)))
    await expect(
      page.getByRole("status").filter({ hasText: /^No more typing to undo/ }),
    ).toBeVisible();
  await expect(text).toContainText("tempo: 120");

  await pressUntil(page, "Control+y", () =>
    expect(text).toContainText("tempo: 150", { timeout: 1_000 }),
  );
  await expectFile(page, WS, PROJECT_FILE, /tempo: 150,/);
  await expect(await tempoReadout(page, 150)).toBeVisible();
  watch.assertClean();
});

test("one Ctrl+Z takes a whole vim change back, and the disk never holds half of it", async ({
  k7,
}) => {
  // A hardware-keyboard shortcut, like the Ctrl+Z/Ctrl+Y test's: a phone undoes through the command bar.
  test.skip(k7.target === "android", "no hardware keyboard on a phone");
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  const watch = watchPage(page);
  await openProject(page);
  await typeTempo(page, 150);
  await expectFile(page, WS, PROJECT_FILE, /tempo: 150,/);
  test.skip(!(await inVim(page)), "the account's editor is not in vim mode");

  const text = editorText(page, "project.k7x");
  await page.keyboard.press("Control+z");
  await expect(text).toContainText("tempo: 120", { timeout: 2_000 });
  const undone = await expectFile(page, WS, PROJECT_FILE, /tempo: 120,/);
  expect(undone).not.toMatch(/tempo: ,/);
  watch.assertClean();
});

test("project undo on a freshly opened project leaves the automatic pin alone", async ({
  k7,
}) => {
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  const watch = watchPage(page);
  await openProject(page);
  const fixture = 'modules({ melody: ["lead"], lead: ["MIX"], MIX: ["OUT"] })';
  // Opening pins the graph's nodes into graph.k7x; wait for that write before undoing.
  const pinned = await expectFile(
    page,
    WS,
    GRAPH_FILE,
    (t) => t.trim() !== fixture,
  );
  await runCommand(page, "project undo");
  await page.waitForTimeout(2_000);
  expect(await readFile(page, WS, GRAPH_FILE)).toBe(pinned);
  watch.assertClean();
});

test("ui ruler from the command bar flips the timeline's ruler to seconds and back", async ({
  k7,
}) => {
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  const watch = watchPage(page);
  await openProject(page);
  const inBars = page.getByRole("button", { name: /^ruler in bars/ });
  const inSeconds = page.getByRole("button", { name: /^ruler in seconds/ });
  await expect(inBars).toBeVisible();
  await runCommand(page, "ui ruler");
  await expect(inSeconds).toBeVisible();
  await expect(inBars).toHaveCount(0);
  await runCommand(page, "ui ruler");
  await expect(inBars).toBeVisible();
  watch.assertClean();
});

test("selection copy and paste from the command bar put a second event on the lane", async ({
  k7,
}) => {
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  const watch = watchPage(page);
  await openProject(page);
  await expect(button(page, "mute melody")).toBeVisible();

  await runCommand(page, "selection copy");
  await expectStatus(page, "copied 1 event(s)");
  // The caret walks the lane on the arrows once the bar has let go of the keyboard.
  if (await commandBar(page).isVisible()) await commandBar(page).blur();
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
  await expectStatus(page, /caret: melody, beat 9/);

  await runCommand(page, "selection paste");
  const node = await expectFile(
    page,
    WS,
    SEQUENCE_NODE,
    (t) => (t.match(/ref\("melody"\)/g) ?? []).length === 2,
  );
  expect(node).toMatch(/ref\("melody"\)\.start\("3:1(:1)?"\)/);

  await runCommand(page, "project undo");
  await expectFile(
    page,
    WS,
    SEQUENCE_NODE,
    (t) => (t.match(/ref\("melody"\)/g) ?? []).length === 1,
  );
  watch.assertClean();
});

test("selection split from the command bar cuts the event under the playhead in two", async ({
  k7,
}) => {
  const page = await k7.open(`/@local/${WS}/${PROJECT}`);
  const watch = watchPage(page);
  await openProject(page);
  await expect(button(page, "mute melody")).toBeVisible();
  const clock = clockOf(page);
  const start = await clock.innerText();
  // The caret walks two beats into the four-beat event, and `t` locates the playhead there.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expectStatus(page, /caret: melody, beat 3/);
  await page.keyboard.press("t");
  await expect(clock).not.toHaveText(start);

  await runCommand(page, "selection split");
  await expectFile(
    page,
    WS,
    SEQUENCE_NODE,
    (t) => (t.match(/ref\("melody/g) ?? []).length === 2,
  );

  await runCommand(page, "project undo");
  await expectFile(
    page,
    WS,
    SEQUENCE_NODE,
    (t) => (t.match(/ref\("melody/g) ?? []).length === 1,
  );
  watch.assertClean();
});
