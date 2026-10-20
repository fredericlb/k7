// surfaces.spec.ts — every archetype opens on the surface it is named for, and each surface DOES its job.
// The desk needs a song in the shared media library: the spec files one, generated here, under "E2E Artist".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { FileService } from "../../src/files.ts";
import { FIXTURES_DIR, FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { navControl } from "../../src/nav.ts";
import { expect, type K7, test } from "../../src/target.ts";
import { play } from "../../src/transport.ts";
import { watchPage } from "../../src/watch.ts";

const WORKSPACE = "E2E-surfaces";
const SONG = { artist: "E2E Artist", album: "E2E Album", title: "E2E Song" };

test.describe.configure({ mode: "serial" });
// A new project is copied to the engine before Play is offered, which can take most of a minute.
test.setTimeout(120_000);

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const lane = (page: Page, name: string) => button(page, `mute ${name}`);
const viewport = (page: Page) => page.getByRole("dialog", { name: "Viewport" });
// A card is named "node (module)", so the rig's recorder node reads "recorder (…)".
const recorderCard = (page: Page) =>
  page.getByRole("button", { name: /^recorder\b/ }).first();

/** What each archetype draws on opening, and whether its header offers a transport to roll. */
const ARCHETYPES: Record<
  string,
  { draws: (p: Page) => Promise<void>; transport: boolean }
> = {
  arrangement: {
    transport: true,
    draws: async (p) => {
      // Any lane, not one by name: the scaffold names its lane nodes, and that name is not this spec's to fix.
      await expect(
        p.getByRole("button", { name: /^mute / }).first(),
      ).toBeVisible();
      await expect(await navControl(p, "Timeline")).toBeVisible();
    },
  },
  mix: {
    transport: false,
    draws: async (p) => {
      await expect(button(p, "deck A")).toBeVisible();
      await expect(button(p, "deck B")).toBeVisible();
      await expect(
        p.getByRole("slider", { name: "crossfade between deck A and deck B" }),
      ).toBeVisible();
    },
  },
  video: {
    transport: true,
    draws: async (p) => {
      await expect(lane(p, "main")).toBeVisible();
      await expect(viewport(p)).toBeVisible();
    },
  },
  live: {
    transport: false,
    draws: async (p) => {
      await expect(recorderCard(p)).toBeVisible({ timeout: 30_000 });
      await expect(await navControl(p, "Timeline")).toHaveCount(0);
    },
  },
  "live-video": {
    transport: false,
    draws: async (p) => {
      await expect(recorderCard(p)).toBeVisible({ timeout: 30_000 });
      await expect(viewport(p)).toBeVisible();
    },
  },
};

/** Copies one fixture project into `workspace`, binaries uploaded, text written. */
async function copyFixture(
  files: FileService,
  project: string,
  workspace: string,
) {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const full = join(dir, n);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  for (const file of walk(join(FIXTURES_DIR, project))) {
    const path = relative(FIXTURES_DIR, file).split("\\").join("/");
    if (path.endsWith(".wav") || path.endsWith(".mp4"))
      await files.upload(workspace, path, readFileSync(file));
    else await files.writeText(workspace, path, readFileSync(file, "utf8"));
  }
}

/** A mono 16-bit sine, long enough for a deck's needle to be seen moving. */
function sineWav(seconds: number, rate = 22050): Buffer {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    b.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / rate)),
      44 + i * 2,
    );
  return b;
}

/** Files the song in the media library, replacing it when a previous run left it there. */
async function fileSong(files: FileService) {
  const query = new URLSearchParams({
    filename: "e2e-song.wav",
    ...SONG,
    replace: "1",
  });
  const res = await files.request.post(`/api/mediatek/song?${query}`, {
    headers: { "content-type": "application/octet-stream" },
    data: sineWav(20),
  });
  expect(res.ok(), `song upload: ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  // …and the library now serves its audio, which is what the desk's row needs to be playable.
  const audio = `songs/${SONG.artist}/${SONG.album}/${SONG.title}/original.wav`;
  const filed = await files.request.head(
    `/api/mediatek/file?path=${encodeURIComponent(audio)}`,
  );
  expect(filed.status(), `${audio} after the upload`).toBe(200);
}

/** How much of an element's picture is lit, read off a screenshot decoded in the page. */
async function lit(
  page: Page,
  el: Locator,
): Promise<{ lit: number; colours: number }> {
  const png = (await el.screenshot()).toString("base64");
  return page.evaluate(async (b64) => {
    // The suite compiles without the DOM lib, so the two browser APIs used are typed here.
    const g = globalThis as unknown as {
      createImageBitmap(b: Blob): Promise<{ width: number; height: number }>;
      OffscreenCanvas: new (
        w: number,
        h: number,
      ) => {
        getContext(k: "2d"): {
          drawImage(i: unknown, x: number, y: number): void;
          getImageData(
            x: number,
            y: number,
            w: number,
            h: number,
          ): { data: Uint8ClampedArray };
        };
      };
    };
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await g.createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const ctx = new g.OffscreenCanvas(bmp.width, bmp.height).getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const colours = new Set<number>();
    let on = 0;
    for (let i = 0; i < d.length; i += 4) {
      colours.add(
        ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4),
      );
      if (Math.max(d[i], d[i + 1], d[i + 2]) > 60) on++;
    }
    return { lit: on / (d.length / 4), colours: colours.size };
  }, png);
}

/** Expects the viewport's canvas to carry a picture: mostly lit, and in more than a few colours. */
async function expectPicture(page: Page) {
  const canvas = viewport(page).locator("canvas").first();
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => (await lit(page, canvas)).lit, {
      message: "the viewport's canvas stayed dark",
      timeout: 15_000,
    })
    .toBeGreaterThan(0.2);
  expect((await lit(page, canvas)).colours, "distinct colours").toBeGreaterThan(
    8,
  );
}

async function openProject(
  k7: K7,
  workspace: string,
  project: string,
): Promise<Page> {
  const page = await k7.open(`/@local/${workspace}/${project}`);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  return page;
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

for (const [shape, { draws, transport }] of Object.entries(ARCHETYPES)) {
  test(`a new ${shape} project opens on its surface${transport ? " and plays" : ""}`, async ({
    k7,
  }) => {
    const files = await workspace(k7);
    const { project } = await files.createProject(
      WORKSPACE,
      shape,
      `${shape}.k7`,
    );
    const page = await openProject(k7, WORKSPACE, project);
    const watch = watchPage(page);
    await draws(page);
    if (transport) {
      await play(page, 90_000);
      await page
        .getByRole("banner")
        .getByRole("button", { name: "Stop", exact: true })
        .click();
    } else {
      // A desk or a rig has no song position, so the header drops Play rather than offer a dead one.
      await expect(
        page.getByRole("banner").getByRole("button", { name: "Play" }),
      ).toHaveCount(0);
    }
    watch.assertClean();
  });
}

const SET = "set.k7";
const DESK = `${SET}/surfaces/desk.k7x`;

/** A set whose desk names a playlist holding the one filed song. */
async function makeSet(k7: K7): Promise<void> {
  const files = await workspace(k7);
  await fileSong(files);
  await files.createProject(WORKSPACE, "mix", SET);
  const desk = await files.readText(WORKSPACE, DESK);
  expect(desk, "the scaffold leaves a playlist line to uncomment").toContain(
    '// playlist("ete-2026")',
  );
  await files.writeText(
    WORKSPACE,
    DESK,
    desk.replace('// playlist("ete-2026")', 'playlist("e2e-set")'),
  );
  await files.writeText(
    WORKSPACE,
    "_playlists/e2e-set.k7x",
    `title("E2E set")\nitems([${JSON.stringify(`${SONG.artist}/${SONG.album}/${SONG.title}`)}])\n`,
  );
}

/** Puts the set's song on deck A from the browser the record's label opens. */
async function putOnDeckA(page: Page) {
  await button(page, "deck A").click();
  const browser = page.getByRole("dialog", { name: "Deck A" });
  await expect(browser.getByText("1 song in the set")).toBeVisible();
  const row = browser.getByRole("button", {
    name: `${SONG.artist} ${SONG.title}`,
  });
  // A row is listed for every line of the set, and enabled only once this machine's library holds its audio.
  await expect(row, "the filed song is not playable here").toBeEnabled();
  await row.click();
  await expect(browser).toBeHidden();
}

test("a set's song goes on a deck, and the crossfader moves", async ({
  k7,
}) => {
  await makeSet(k7);
  const page = await openProject(k7, WORKSPACE, SET);
  await putOnDeckA(page);
  // The label names the record, and the deck's start button wakes up.
  await expect(
    page.getByText(SONG.title, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^start deck A/ }),
  ).toBeEnabled();
  await expect(page.getByText("nothing loaded", { exact: true })).toHaveCount(
    1,
  );
  const fader = page.getByRole("slider", {
    name: "crossfade between deck A and deck B",
  });
  await expect(fader).toHaveValue("0.5");
  await fader.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(fader).toHaveValue("0.55");
});

test("a record on deck A plays", async ({ k7 }) => {
  const page = await openProject(k7, WORKSPACE, SET);
  await putOnDeckA(page);
  await page.getByRole("button", { name: /^start deck A/ }).click();
  await expect(
    page.getByRole("button", { name: /^stop deck A/ }),
  ).toHaveAttribute("aria-pressed", "true");
  // The needle is drawn on a canvas, so what is read is the engine's refusal, given the seconds it takes to arrive.
  await page.waitForTimeout(5_000);
  await expect(
    page.getByText(/outside the folders this engine reads/),
  ).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Some sounds could not be loaded" }),
  ).toHaveCount(0);
});

test("the video-lane fixture's viewport draws its picture", async ({ k7 }) => {
  const page = await openProject(k7, FIXTURES_WORKSPACE, "video-lane.k7");
  const watch = watchPage(page);
  await expect(viewport(page)).toBeVisible();
  await expectPicture(page);
  watch.assertClean();
});

test("live-video's viewport draws the webcam", async ({ k7 }) => {
  const page = await openProject(k7, WORKSPACE, "live-video.k7");
  await expect(viewport(page)).toBeVisible();
  await expectPicture(page);
});

test("a mastering control writes its node file", async ({ k7 }) => {
  const files = await workspace(k7);
  await copyFixture(files, "mastering.k7", WORKSPACE);
  const node = "mastering.k7/nodes/master.k7x";
  const before = await files.readText(WORKSPACE, node);
  const page = await openProject(k7, WORKSPACE, "mastering.k7");
  const watch = watchPage(page);
  await (await navControl(page, "Mastering")).click();
  const width = page.getByRole("slider", { name: /^Width/ });
  await expect(width).toHaveValue("100");
  await width.focus();
  // Each key is a gesture the strip writes on key-up; paced, since a key landing before the engine echoes the last is lost.
  for (let v = 101; v <= 105; v++) {
    await page.keyboard.press("ArrowRight");
    await expect(width).toHaveValue(String(v));
  }
  await expect
    .poll(() => files.readText(WORKSPACE, node), { timeout: 10_000 })
    .toMatch(/Width"?\s*:\s*105\b/);
  expect(before).not.toMatch(/Width/);
  watch.assertClean();
});
