// rehearsal.spec.ts — the rehearsal pages a microphone is not needed for: the exercises, a public page.
// What the suite makes is named E2E and removed over the recorder's own API at start and end, so a rerun starts clean.
import type { Page } from "@playwright/test";
import { expect, TARGET, test } from "../../src/target.ts";
import { watchPage } from "../../src/watch.ts";

const _ARTIST = "E2E Band";
const _TITLE = "E2E Sheet";
const NAMETAG = "e2etestpage";
/** Removes the suite's public page, whatever a failed run left. */
async function sweep(page: Page): Promise<void> {
  const api = page.request;
  // Absolute, off the page: a phone's WebView hands its request context no base URL.
  const at = (path: string) => new URL(path, page.url()).href;
  const pages = await listed<{ id: string; nametag: string }>(
    page,
    at("/api/pages"),
  );
  for (const p of pages.filter((x) => x.nametag === NAMETAG))
    expect((await api.delete(at(`/api/pages/${p.id}`))).ok()).toBe(true);
}

/** A list route's rows, or none when it answers something else: a clean-up has nothing to remove then. */
async function listed<T>(page: Page, url: string): Promise<T[]> {
  const res = await page.request.get(url);
  const body: unknown = res.ok() ? await res.json() : [];
  return Array.isArray(body) ? (body as T[]) : [];
}

test("the exercises open: random chords, the tuner, singing", async ({
  k7,
}) => {
  const page = await k7.open("/rehearsal/exercises");
  const watch = watchPage(page);
  await page.getByRole("button", { name: /^Random chords/ }).click();
  await expect(
    page.getByRole("heading", { name: "Random chords" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Next chord" })).toBeVisible();
  await page.getByRole("button", { name: "Back to Exercises" }).click();

  await page.getByRole("button", { name: /^Guitar tuner/ }).click();
  await expect(page).toHaveURL(/\/rehearsal\/exercises\/tuner$/);
  await expect(
    page.getByRole("heading", { name: "Guitar tuner" }),
  ).toBeVisible();
  // Starting it asks for the microphone, which a headless run has none of: the button is what is checked.
  await expect(
    page.getByRole("button", { name: "Start tuning" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Back to Exercises" }).click();

  await page.getByRole("button", { name: /^Singing exercises/ }).click();
  await expect(
    page.getByRole("heading", { name: "Singing exercises" }),
  ).toBeVisible();
  watch.assertClean();
});

test("a public page opens signed out at /rehearsal/@<nametag>", async ({
  k7,
  browser,
  baseURL,
}) => {
  test.skip(
    TARGET !== "web",
    "a signed-out visitor is a second browser context, which only the web target has",
  );
  const page = await k7.open("/rehearsal/pages/new");
  await sweep(page);
  await page.reload();
  const watch = watchPage(page);
  await expect(page.getByRole("heading", { name: "New page" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Nametag (letters and numbers, no spaces)" })
    .fill(NAMETAG);
  await page.getByRole("radio", { name: "Public" }).check();
  await page.getByRole("button", { name: "Create page" }).click();
  await expect(page).toHaveURL(/\/rehearsal\/pages\/[^/]+$/);
  await expect(page.getByText(`@${NAMETAG}`).first()).toBeVisible();
  watch.assertClean();

  const visitor = await browser.newContext({ baseURL });
  try {
    const anon = await visitor.newPage();
    const anonWatch = watchPage(anon);
    await anon.goto(`/rehearsal/@${NAMETAG}`);
    await expect(
      anon.getByRole("heading", { name: `@${NAMETAG}` }),
    ).toBeVisible();
    await expect(anon.getByText(`Sign in to open @${NAMETAG}.`)).toBeHidden();
    anonWatch.assertClean();
  } finally {
    await visitor.close();
  }
  await sweep(page);
});
