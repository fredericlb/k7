// features.spec.ts — each fixture project opens in the browser and DRAWS its feature; the ones with a timeline also play.
// One entry per fixture in e2e/fixtures; the table is what a reader checks against fixtures/README.md.
import { expect, type Page, test } from "@playwright/test";
import { FIXTURES_WORKSPACE } from "../../src/fixtures.ts";
import { watchPage } from "../../src/watch.ts";

type Check = (page: Page) => Promise<void>;

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const lane =
  (name: string): Check =>
  async (page) => {
    await expect(button(page, `mute ${name}`)).toBeVisible();
  };

/** What each fixture must show once open; `play: false` for one with no transport to roll, `bug` for a known failure. */
const FEATURES: Record<string, { check: Check; play?: boolean; bug?: string }> =
  {
    "clip-lane.k7": { check: lane("drums") },
    "clip-loop.k7": { check: lane("drums") },
    "clip-fades.k7": { check: lane("drums") },
    "clip-warp.k7": { check: lane("drums") },
    "note-lane.k7": { check: lane("melody") },
    "strudel-lane.k7": { check: lane("pad") },
    "group-lane.k7": {
      check: async (page) => {
        await lane("kicks")(page);
        await lane("snares")(page);
        await expect(
          page.getByText("drums", { exact: false }).first(),
        ).toBeVisible();
      },
    },
    "curves.k7": { check: lane("melody") },
    "rack.k7": { check: lane("beat") },
    "ports.k7": {
      check: async (page) => {
        await lane("deckA")(page);
        await lane("deckB")(page);
      },
    },
    "doc-note.k7": {
      check: async (page) => expect(button(page, "Toggle docs")).toBeEnabled(),
    },
    "mute-solo.k7": {
      check: async (page) => {
        await expect(button(page, "solo kicks")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(button(page, "mute muted")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(button(page, "solo snares")).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      },
    },
    "mixer-strip.k7": {
      check: async (page) => expect(button(page, "Mix panel")).toBeEnabled(),
    },
    "master-chain.k7": { check: lane("drums") },
    "mastering.k7": {
      check: async (page) => {
        await button(page, "Mastering").click();
        await expect(page.getByText("Limiter", { exact: true })).toBeVisible();
      },
    },
    "library-module.k7": { check: lane("drums") },
    "video-lane.k7": {
      check: async (page) =>
        expect(page.getByRole("dialog", { name: "Viewport" })).toBeVisible(),
    },
    "markers-settings.k7": {
      check: async (page) => {
        await expect(page.getByText("96 bpm·3/4")).toBeVisible();
        await expect(button(page, "Metronome")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      },
    },
    "chains-only.k7": {
      play: false,
      check: async (page) => {
        await expect(button(page, "Chains")).toBeVisible();
        await expect(button(page, "Timeline")).toHaveCount(0);
      },
    },
  };

const BROKEN = ["broken-unresolved.k7", "broken-sequence.k7"];

async function openProject(page: Page, project: string) {
  await page.goto(`/@local/${FIXTURES_WORKSPACE}/${project}`);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    { timeout: 30_000 },
  );
}

for (const [project, { check, play = true, bug }] of Object.entries(FEATURES)) {
  test(`${project} draws its feature${play ? " and plays" : ""}`, async ({
    page,
  }) => {
    test.fail(!!bug, bug);
    const watch = watchPage(page);
    await openProject(page, project);
    await check(page);
    if (play) {
      const clock = page.getByRole("banner").getByText(/^\d+:\d\d·\d+:\d+/);
      const before = await clock.innerText();
      await button(page, "Play").click();
      await expect(clock).not.toHaveText(before, { timeout: 5_000 });
      await button(page, "Stop").click();
    }
    watch.assertClean();
  });
}

for (const project of BROKEN) {
  test(`${project} says why it does not load`, async ({ page }) => {
    const watch = watchPage(page);
    await openProject(page, project);
    await expect(page.getByText(/timeline unavailable/)).toBeVisible();
    await expect(
      page.getByRole("contentinfo").getByText(/\d+ errors?/),
    ).toBeVisible();
    watch.assertClean();
  });
}
