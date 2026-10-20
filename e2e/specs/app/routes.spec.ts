// routes.spec.ts — the home's side pages and the two hosts no other spec opens: each draws its own content, not just no error.
// `/external`, `/settings`, `/settings/engine`, `/libraries`, `/about`, `/tasks`, and the documentation host.
import type { Page } from "@playwright/test";
import { FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { expect, TARGET, test } from "../../src/target.ts";
import { watchPage } from "../../src/watch.ts";

/** Moves the router to `path` without a reload, as the account menu's own items do. */
async function routeTo(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    const win = globalThis as unknown as {
      history: { pushState(s: unknown, t: string, u: string): void };
      dispatchEvent(e: unknown): void;
      PopStateEvent: new (type: string) => unknown;
    };
    win.history.pushState({}, "", to);
    win.dispatchEvent(new win.PopStateEvent("popstate"));
  }, path);
}

test("/external lists the surfaces of the project the engine holds", async ({
  k7,
}) => {
  // The menu lists what the engine already holds, so a project is opened on it first.
  const project = await k7.open(`/@local/${FIXTURES_WORKSPACE}/clip-lane.k7`);
  await expect(
    project.getByRole("img", { name: "engine connected" }),
  ).toBeVisible({ timeout: 30_000 });
  const page = await k7.open("/external");
  const watch = watchPage(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `${FIXTURES_WORKSPACE} / clip-lane.k7`,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  const timeline = page.getByRole("link", { name: /timeline/i });
  await expect(timeline).toHaveAttribute(
    "href",
    new RegExp(
      `/@local/${FIXTURES_WORKSPACE}/clip-lane\\.k7/@external/timeline$`,
    ),
  );
  watch.assertClean();
});

test("/settings draws every section with its controls", async ({ k7 }) => {
  const page = await k7.open("/settings");
  const watch = watchPage(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
  for (const name of [
    "Language",
    "Separation chains",
    "AI",
    "Paired devices",
    "Sync",
    "Rehearsal",
  ])
    await expect(
      page.getByRole("heading", { level: 2, name, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Engines", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Français" })).toBeEnabled();
  await expect(
    page.getByRole("combobox", {
      name: "the chain that splits a song into stems",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", {
      name: "the chain that gives a song without its voice",
    }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "sk-ant-…" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate token" }),
  ).toBeVisible();
  watch.assertClean();
});

test("/settings/engine says on the web that it is the desktop app's page", async ({
  k7,
}) => {
  const page = await k7.open("/settings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
  const watch = watchPage(page);
  // Reached the way the account menu reaches it: a route change, not a load.
  await routeTo(page, "/settings/engine");
  await expect(
    page.getByRole("heading", { level: 1, name: "This machine's engine" }),
  ).toBeVisible();
  if (TARGET === "web")
    await expect(
      page.getByText(
        "This page is the desktop app's: open it there to set its built-in engine.",
      ),
    ).toBeVisible();
  watch.assertClean();
});

test("/settings/engine opens when loaded by its address", async ({ k7 }) => {
  const page = await k7.open("/settings/engine");
  await expect(
    page.getByRole("heading", { level: 1, name: "This machine's engine" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("/libraries lists the origin's libraries", async ({ k7 }) => {
  const page = await k7.open("/libraries");
  const watch = watchPage(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Libraries" }),
  ).toBeVisible();
  await expect(page.getByText("@k7-core", { exact: true })).toBeVisible();
  watch.assertClean();
});

test("/about shows the licence and filters the third-party notices", async ({
  k7,
}) => {
  const page = await k7.open("/about");
  const watch = watchPage(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "About" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Licence" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(
    page.getByText(/GNU GENERAL PUBLIC LICENSE/).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Third-party notices" }),
  ).toBeVisible();
  const count = page.getByText(/^\d+ of \d+ components$/);
  const all = Number((await count.innerText()).split(" ")[2]);
  expect(all).toBeGreaterThan(10);
  await page
    .getByRole("textbox", { name: "Search by name, licence or version" })
    .fill("codemirror");
  await expect
    .poll(async () => Number((await count.innerText()).split(" ")[0]))
    .toBeLessThan(all);
  const notice = page.getByRole("button", { name: /^@codemirror\/state / });
  await notice.click();
  await expect(
    page.getByText(/Permission is hereby granted/).first(),
  ).toBeVisible();
  watch.assertClean();
});

test("/tasks lists the workspaces' TODOS.md, done ones on demand", async ({
  k7,
}) => {
  const page = await k7.open("/tasks");
  const watch = watchPage(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
  await expect(page.getByText("E2E open task")).toBeVisible();
  await expect(page.getByText("E2E done task")).toBeHidden();
  await page.getByRole("checkbox", { name: "Show done" }).check();
  await expect(page.getByText("E2E done task")).toBeVisible();
  watch.assertClean();
});

test("/docs on the app's origin is no page, and says the way back", async ({
  k7,
}) => {
  const page = await k7.open("/docs");
  const watch = watchPage(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "That project isn't in the workspace",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to Projects" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Projects" }),
  ).toBeVisible();
  watch.assertClean();
});

test("the documentation host draws a guide, a page and its nav", async ({
  k7,
  baseURL,
}) => {
  const app = new URL(baseURL ?? "");
  test.skip(
    TARGET !== "web" || !app.hostname.startsWith("app."),
    "the docs host is the hosted instance's docs.<domain>; the apps have none",
  );
  const docs = `${app.protocol}//docs.${app.hostname.slice("app.".length)}`;
  const page = await k7.open(`${docs}/`);
  const watch = watchPage(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "k7 documentation" }),
  ).toBeVisible();
  await page
    .getByRole("banner")
    .getByRole("link", { name: "User guide" })
    .click();
  await expect(page).toHaveURL(`${docs}/user`);
  await expect(
    page.getByRole("heading", { level: 1, name: "k7 user guide" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation");
  await nav.getByRole("link", { name: "Signing in", exact: true }).click();
  await expect(page).toHaveURL(`${docs}/user/02-signing-in`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Signing in" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open k7" })).toHaveAttribute(
    "href",
    new RegExp(`^${app.origin}`),
  );
  watch.assertClean();
});
