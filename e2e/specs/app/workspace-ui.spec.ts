// workspace-ui.spec.ts — a workspace and its projects made, renamed, copied and deleted through the home page's own dialogs.
// Each act is checked twice: on the screen, and in the file service's listing the page itself reads.
import type { Locator, Page } from "@playwright/test";
import { FileService } from "../../src/files.ts";
import { expect, test } from "../../src/target.ts";
import { watchPage } from "../../src/watch.ts";

const WS = "E2E-ui";
const TARGET_WS = "E2E-ui-copy";
// The list re-reads after an act, and the relay may answer a beat behind the service.
const SHOWN = { timeout: 15_000 };

/** The account's workspaces and their project folders, as GET /workspaces/projects answers them. */
async function listing(page: Page): Promise<Record<string, string[]>> {
  const workspaces = await (await FileService.ofPage(page)).projects();
  return Object.fromEntries(
    workspaces.map((w) => [w.name, w.projects.map((p) => p.path).sort()]),
  );
}

/** Polls the listing until `ws` holds exactly `projects`; undefined means the workspace is absent. */
async function expectListed(
  page: Page,
  ws: string,
  projects: string[] | undefined,
): Promise<void> {
  await expect
    .poll(async () => (await listing(page))[ws], {
      message: `${ws} should list ${projects}`,
      timeout: 15_000,
    })
    .toEqual(projects);
}

/** A workspace's block on the home page, found by its header button ("E2E-ui 1 project"). */
function workspaceRow(page: Page, ws: string): Locator {
  return page.getByRole("listitem").filter({
    has: page.getByRole("button", {
      name: new RegExp(`^${ws} \\d+ projects?$`),
    }),
  });
}

/** The project's ⋮ menu inside `row`, opened on the item named `act`. */
async function projectAct(
  page: Page,
  row: Locator,
  label: string,
  act: string,
): Promise<Locator> {
  await row
    .getByRole("button", {
      name: `What can be done with ${label}`,
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: act, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Makes a workspace through the "New workspace" dialog. */
async function newWorkspace(page: Page, ws: string): Promise<void> {
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await dialog.getByRole("textbox").fill(ws);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(workspaceRow(page, ws)).toBeVisible();
}

test("a workspace and its project are made, renamed, copied and deleted from the home page", async ({
  k7,
}) => {
  test.setTimeout(180_000);
  const files = await k7.files();
  // Recreated by the UI below, so a rerun starts from nothing.
  await files.removeWorkspace(WS);
  await files.removeWorkspace(TARGET_WS);

  const page = await k7.open("/");
  const watch = watchPage(page);
  await expect(
    page.getByRole("heading", { name: "Projects", level: 1 }),
  ).toBeVisible();

  await test.step("create two workspaces", async () => {
    await newWorkspace(page, WS);
    await newWorkspace(page, TARGET_WS);
    await expectListed(page, WS, []);
    await expectListed(page, TARGET_WS, []);
  });

  const row = workspaceRow(page, WS);

  await test.step("create a DJ set project in the archetype dialog", async () => {
    await row
      .getByRole("button", { name: "Create a project in this workspace" })
      .click();
    const dialog = page.getByRole("dialog", { name: "New project" });
    await dialog.getByText("DJ set", { exact: true }).click();
    await expect(dialog.getByRole("radio", { name: /^DJ set/ })).toBeChecked();
    await dialog.getByRole("textbox").fill("first");
    await expect(dialog.getByText(`${WS}/first.k7`)).toBeVisible();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expectListed(page, WS, ["first.k7"]);
    await expect(row.locator(`a[href$="/@local/${WS}/first.k7"]`)).toBeVisible(
      SHOWN,
    );
    await expect(row.getByRole("img", { name: "DJ set" })).toBeVisible();
  });

  await test.step("rename it", async () => {
    const dialog = await projectAct(page, row, "first", "Rename");
    // The rename field carries no label and no placeholder: the dialog's only textbox.
    await dialog.getByRole("textbox").fill("renamed");
    await dialog.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expectListed(page, WS, ["renamed.k7"]);
    await expect(
      row.locator(`a[href$="/@local/${WS}/renamed.k7"]`),
    ).toBeVisible(SHOWN);
    await expect(row.locator(`a[href$="/@local/${WS}/first.k7"]`)).toHaveCount(
      0,
    );
  });

  await test.step("copy it into the other workspace", async () => {
    const dialog = await projectAct(page, row, "renamed", "Copy");
    await dialog.getByRole("button", { name: TARGET_WS, exact: true }).click();
    await expect(dialog.getByText(`${TARGET_WS} / renamed.k7`)).toBeVisible();
    await dialog.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await expectListed(page, TARGET_WS, ["renamed.k7"]);
    const target = workspaceRow(page, TARGET_WS);
    await expect(
      target.locator(`a[href$="/@local/${TARGET_WS}/renamed.k7"]`),
    ).toBeVisible(SHOWN);
    await expectListed(page, WS, ["renamed.k7"]);
  });

  await test.step("delete the copy", async () => {
    const target = workspaceRow(page, TARGET_WS);
    const dialog = await projectAct(page, target, "renamed", "Delete");
    await expect(
      dialog.getByRole("heading", { name: "Delete “renamed”?" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expectListed(page, TARGET_WS, []);
    await expect(
      target.locator(`a[href$="/@local/${TARGET_WS}/renamed.k7"]`),
    ).toHaveCount(0, SHOWN);
    // The original is untouched by deleting its copy.
    await expectListed(page, WS, ["renamed.k7"]);
  });

  watch.assertClean();
  await files.removeWorkspace(WS);
  await files.removeWorkspace(TARGET_WS);
});
