// rehearsal.spec.ts — the rehearsal pages a microphone is not needed for: a songbook sheet, the exercises, a public page.
// What the suite makes is named E2E and removed over the recorder's own API at start and end, so a rerun starts clean.
import type { Page } from "@playwright/test";
import { expect, TARGET, test } from "../../src/target.ts";
import { watchPage } from "../../src/watch.ts";

const ARTIST = "E2E Band";
const TITLE = "E2E Sheet";
const NAMETAG = "e2etestpage";
const LYRICS = "[Am]Hello [G]rehearsal\n[C]second line";

/** Removes the suite's songbook songs and its public page, whatever a failed run left. */
async function sweep(page: Page): Promise<void> {
  const api = page.request;
  // Absolute, off the page: a phone's WebView hands its request context no base URL.
  const at = (path: string) => new URL(path, page.url()).href;
  const songs = await listed<{ id: string; artist: string }>(
    page,
    at("/api/songs"),
  );
  for (const s of songs.filter((x) => x.artist === ARTIST))
    expect((await api.delete(at(`/api/songs/${s.id}`))).ok()).toBe(true);
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

/** Makes the suite's songbook song and types its lyrics; answers once Save has written them. */
async function songWithLyrics(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New song" }).click();
  await expect(page.getByRole("heading", { name: "New song" })).toBeVisible();
  await page.getByRole("textbox", { name: "Artist" }).fill(ARTIST);
  await page.getByRole("textbox", { name: "Title" }).fill(TITLE);
  await page.getByRole("radio", { name: /^Private/ }).check();
  await page.getByRole("button", { name: "Create song" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: TITLE }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/rehearsal\/songs\/[^/]+/);
  await page.getByRole("button", { name: "Song menu" }).click();
  await page.getByRole("menuitem", { name: "Add lyrics" }).click();
  await page
    .getByRole("textbox", { name: "Type the lyrics here…" })
    .fill(LYRICS);
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  // Save greys out once the draft equals what the server answered.
  await expect(save).toBeDisabled({ timeout: 10_000 });
}

test("a songbook song's chord sheet renders its chords and lyrics", async ({
  k7,
}) => {
  const page = await k7.open("/rehearsal/songs");
  await sweep(page);
  await page.reload();
  const watch = watchPage(page);
  await songWithLyrics(page);
  // Read back from the server: the editor itself does not close on Save (the next test).
  await page.reload();
  // A chord of the sheet is a button that opens its diagram; the words around it stay text.
  for (const chord of ["Am", "G", "C"])
    await expect(
      page.getByRole("button", { name: chord, exact: true }),
    ).toBeVisible();
  await expect(page.getByText("rehearsal", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit lyrics" })).toBeVisible();
  await page.getByRole("button", { name: "Back to Songbook" }).click();
  await expect(page.getByText(TITLE)).toBeVisible();
  watch.assertClean();
  await sweep(page);
});

test("saving a song's first lyrics shows the rendered sheet", async ({
  k7,
}) => {
  test.fail(
    true,
    "SongDetailView never leaves the editor after Save: its effect resets `editing` only on a new song or tab, so the sheet shows only after a reload",
  );
  const page = await k7.open("/rehearsal/songs");
  await sweep(page);
  await page.reload();
  try {
    await songWithLyrics(page);
    await expect(
      page.getByRole("textbox", { name: "Type the lyrics here…" }),
    ).toBeHidden({
      timeout: 5_000,
    });
    await expect(
      page.getByRole("button", { name: "Am", exact: true }),
    ).toBeVisible();
  } finally {
    await sweep(page);
  }
});

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
