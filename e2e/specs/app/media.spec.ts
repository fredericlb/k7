// media.spec.ts — the media library from its own screens: a song uploaded, opened, edited and played, then put in a playlist.
// Removing from the shared library is an admin's (apps/k7/backend/docs/media/gate.md), so the suite's song and playlist are reused, not deleted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURES_DIR } from "../../src/fixtures.ts";
import { expect, test } from "../../src/target.ts";
import { watchPage } from "../../src/watch.ts";

const ARTIST = "E2E Artist";
const ALBUM = "E2E Album";
const TITLE = "E2E Song";
const FOLDER = `songs/${ARTIST}/${ALBUM}/${TITLE}`;
const PLAYLIST = "e2e-playlist";

/** A library file's text over the media library's own route, as the editor reads it. */
async function libraryText(page: Page, path: string): Promise<string> {
  // Absolute, off the page: a phone's WebView hands its request context no base URL.
  const url = new URL(
    `/api/mediatek/file?path=${encodeURIComponent(path)}`,
    page.url(),
  );
  const res = await page.request.get(url.href);
  return res.ok() ? res.text() : "";
}

/** Uploads the committed WAV through "Add a song"; a rerun finds the folder taken and replaces it. */
async function addSong(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add a song" }).first().click();
  await (await chooser).setFiles({
    name: "e2e-song.wav",
    mimeType: "audio/wav",
    buffer: readFileSync(join(FIXTURES_DIR, "_references/e2e-reference.wav")),
  });
  const dialog = page.getByRole("dialog", { name: "Add a song" });
  await expect(dialog.getByText("Reading the tags…")).toBeHidden();
  await dialog.getByRole("textbox", { name: "Artist" }).fill(ARTIST);
  await dialog.getByRole("textbox", { name: "Album" }).fill(ALBUM);
  await dialog.getByRole("textbox", { name: "Title" }).fill(TITLE);
  await expect(dialog.getByText(`${FOLDER}/original.wav`)).toBeVisible();
  await dialog.getByRole("button", { name: "Upload", exact: true }).click();
  const replace = dialog.getByRole("button", { name: "Replace", exact: true });
  const outcome = await Promise.race([
    dialog.waitFor({ state: "hidden", timeout: 30_000 }).then(() => "filed"),
    replace.waitFor({ timeout: 30_000 }).then(() => "occupied"),
  ]);
  if (outcome === "occupied") await replace.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

test("a song is uploaded, edited and played, then put in a playlist", async ({
  k7,
}) => {
  test.setTimeout(180_000);
  const page = await k7.open("/media/songs");
  // A phone has no ffmpeg, so its library answers the analysis 503 (engine/k7-runtime/docs/android.md).
  const watch = watchPage(
    page,
    k7.target === "android" ? [/\/api\/mediatek\/analyse$/] : [],
  );

  await test.step("upload it with Add a song", async () => {
    await addSong(page);
    const tree = page.getByRole("complementary").last();
    await expect(tree.getByRole("button", { name: ARTIST })).toBeVisible();
    // A narrow screen lists the new folder folded: open the artist, then the album, as a thumb would.
    for (const folder of [ARTIST, ALBUM]) {
      const song = page.getByRole("button", { name: TITLE }).first();
      const row = tree.getByRole("button", { name: folder });
      if (!(await song.isVisible()) && (await row.isVisible()))
        await row.click();
    }
    await expect(
      page.getByRole("button", { name: TITLE }).first(),
    ).toBeVisible();
  });

  await test.step("open it and edit its sidecar", async () => {
    await page.getByRole("button", { name: TITLE }).first().click();
    await expect(page).toHaveURL(
      /\/media\/songs\/E2E%20Artist\/E2E%20Album\/E2E%20Song/,
    );
    await expect(page.getByText(`Song · ${TITLE}`)).toBeVisible();
    const mark = `# e2e ${Date.now()}`;
    await page.getByRole("textbox", { name: / — song info$/ }).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(mark);
    await expect
      .poll(() => libraryText(page, `${FOLDER}/song.yaml`), { timeout: 15_000 })
      .toContain(mark);
    await expect(page.getByText("saved", { exact: true })).toBeVisible();
  });

  await test.step("play it: the mini player bar takes it", async () => {
    // The song player's header, beside its clock: the mini player bar has a Play of its own.
    const header = page
      .locator("header")
      .filter({ hasText: /\d:\d\d \/ \d:\d\d/ });
    await header.getByRole("button", { name: "Play", exact: true }).click();
    const bar = page.getByRole("region", { name: "Now playing" });
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(bar.getByText(TITLE)).toBeVisible();
    await bar.getByRole("button", { name: "Close the player" }).click();
    await expect(bar).toBeHidden();
  });

  await test.step("add it to a playlist", async () => {
    await page.getByRole("link", { name: "Playlists" }).click();
    await expect(page).toHaveURL(/\/media\/playlists\/?$/);
    const row = page.getByRole("button", { name: PLAYLIST, exact: true });
    const opened = new RegExp(`/media/playlists/${PLAYLIST}\\.yaml$`);
    // The list loads after the page: a short wait tells "not there yet" from "not there".
    const listed = await row
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!listed) {
      await page.getByRole("button", { name: "New playlist" }).click();
      await page
        .getByPlaceholder("summer-2026, or live/rehearsal")
        .fill(PLAYLIST);
      await page.keyboard.press("Enter");
    }
    // Creating opens it, and a narrow screen then hides the list (packages/ui-library/docs/responsive.md).
    await expect(async () => {
      expect(opened.test(page.url()) || (await row.isVisible())).toBe(true);
    }).toPass({ timeout: 15_000 });
    if (!opened.test(page.url())) await row.click();
    await expect(page).toHaveURL(opened);
    // The open playlist's header names its file, on either layout.
    await expect(
      page.getByText(`playlists/${PLAYLIST}.yaml`, { exact: true }),
    ).toBeVisible();
    // A rerun empties what the last one added, through the rows' own Remove.
    const remove = page.getByRole("button", { name: "Remove", exact: true });
    while ((await remove.count()) > 0) {
      const before = await remove.count();
      await remove.first().click();
      await expect(remove).toHaveCount(before - 1);
    }
    await page.getByRole("button", { name: "Search for a song" }).click();
    await page.getByPlaceholder("title, artist or album").fill(TITLE);
    await page
      .getByRole("button", { name: new RegExp(`^${TITLE}`) })
      .first()
      .click();
    await expect(page.getByText("1 song", { exact: true })).toBeVisible();
    await expect
      .poll(() => libraryText(page, `playlists/${PLAYLIST}.yaml`), {
        timeout: 15_000,
      })
      .toContain(TITLE);
  });

  await test.step("removing either is an admin's: no account here may", async () => {
    // An app's local user (desktop or phone) owns its library, so the deletes would succeed and take the song the desk specs use.
    if (k7.target !== "web") return;
    const at = (path: string) => new URL(path, page.url()).href;
    const song = await page.request.delete(
      at(`/api/mediatek/folder?path=${encodeURIComponent(FOLDER)}`),
    );
    expect(song.status()).toBe(403);
    const list = await page.request.delete(
      at(
        `/api/mediatek/file?path=${encodeURIComponent(`playlists/${PLAYLIST}.yaml`)}`,
      ),
    );
    expect(list.status()).toBe(403);
  });

  watch.assertClean();
});
