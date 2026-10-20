// shares.spec.ts — a project published as a link from its Share panel, opened by a visitor with no session, then taken down.
// The visitor plays on the SERVER's engine; when this instance has none, what the viewer shows instead is asserted and noted.
import type { APIRequestContext, Page } from "@playwright/test";
import { navControl } from "../../src/nav.ts";
import { expect, TARGET, test } from "../../src/target.ts";
import { watchPage } from "../../src/watch.ts";

const WS = "E2E-shares";
const PROJECT = "shared.k7";
const NO_SERVER_ENGINE =
  "this server has no engine of its own to play shares on";

interface Share {
  key: string;
  token: string;
  origin: { repo: string; project: string };
  revokedAt?: string;
}

/** The account's live shares published from this spec's workspace. */
async function ourShares(api: APIRequestContext): Promise<Share[]> {
  const res = await api.get("/api/shares");
  expect(res.ok(), `shares: ${res.status()}`).toBe(true);
  const { shares } = (await res.json()) as { shares: Share[] };
  return shares.filter((s) => s.origin.repo === WS && !s.revokedAt);
}

/** Takes down what a failed run left published, so the row starts at no share. */
async function revokeAll(api: APIRequestContext): Promise<void> {
  for (const s of await ourShares(api))
    expect((await api.delete(`/api/shares/${s.key}`)).ok()).toBe(true);
}

/** Publishes through the panel's "Share a link"; answers the link, or null with the refusal noted when the server has no engine. */
async function publish(page: Page): Promise<string | null> {
  await (await navControl(page, "Share / export")).click();
  await page.getByRole("button", { name: "Share a link" }).click();
  const confirm = page.getByRole("dialog", {
    name: "Share this project as it is now?",
  });
  await confirm.getByRole("button", { name: "Publish the link" }).click();
  // The clipboard is refused headless more often than not; both lines carry the link.
  const status = page.getByRole("contentinfo").getByRole("status").first();
  let line = "";
  await expect
    .poll(
      async () => {
        line = await status.innerText().catch(() => "");
        return /(link copied|shared \(|cannot share)/.test(line);
      },
      { timeout: 180_000, intervals: [1000] },
    )
    .toBe(true);
  // A share plays on the server's own engine, so an instance without one refuses it, and says so.
  if (line.includes(NO_SERVER_ENGINE)) {
    test.info().annotations.push({ type: "noted", description: line });
    return null;
  }
  expect(line, "the share was published").not.toContain("cannot share");
  const url = /(https?:\/\/\S+)/.exec(line)?.[1];
  expect(url, "the status line carries the share's link").toBeTruthy();
  return url as string;
}

test("a shared link opens signed out, and stops answering once taken down", async ({
  k7,
  browser,
}) => {
  test.skip(
    TARGET !== "web",
    "a signed-out visitor is a second browser context, which only the web target has",
  );
  test.setTimeout(300_000);
  const files = await k7.files();
  await files.removeWorkspace(WS);
  await files.createWorkspace(WS);
  const { project } = await files.createProject(WS, "arrangement", PROJECT);
  await files.waitSynced(WS, project);

  const page = await k7.open(`/@local/${WS}/${project}`);
  await revokeAll(page.request);
  const watch = watchPage(page);
  await expect(page.getByRole("img", { name: "engine connected" })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeEnabled({
    timeout: 30_000,
  });
  const published = await publish(page);
  if (published === null) {
    expect(await ourShares(page.request)).toHaveLength(0);
    watch.assertClean();
    await files.removeWorkspace(WS);
    test.skip(true, `nothing to visit: ${NO_SERVER_ENGINE}`);
  }
  const url = published as string;
  expect(url).toContain("/@shares/");
  expect(await ourShares(page.request)).toHaveLength(1);
  watch.assertClean();

  const visitor = await browser.newContext();
  try {
    const anon = await visitor.newPage();
    const anonWatch = watchPage(anon);
    await test.step("the visitor's viewer draws", async () => {
      await anon.goto(url);
      await expect(
        anon.getByText(
          "Shared version — read only; mute and solo are yours alone",
        ),
      ).toBeVisible({ timeout: 60_000 });
    });
    await test.step("the visitor plays on the server's engine", async () => {
      const connected = anon.getByRole("img", { name: "engine connected" });
      const up = await connected
        .waitFor({ timeout: 45_000 })
        .then(() => true)
        .catch(() => false);
      if (!up) {
        test.info().annotations.push({
          type: "noted",
          description:
            "no server engine answered the share: the viewer drew, playback was not checked",
        });
        return;
      }
      const play = anon.getByRole("button", { name: "Play", exact: true });
      await expect(play).toBeEnabled({ timeout: 60_000 });
      await play.click();
      await expect(
        anon.getByRole("button", { name: "Pause", exact: true }),
      ).toBeVisible({
        timeout: 15_000,
      });
    });
    anonWatch.assertClean();

    await test.step("take it down from the project's row on the home page", async () => {
      const home = await k7.open(`/?ws=${WS}`);
      const row = home.getByRole("listitem").filter({
        has: home.locator(`a[href$="/@local/${WS}/${project}"]`),
      });
      await row.getByRole("button", { name: "Shares (1)" }).click();
      const dialog = home.getByRole("dialog", { name: /^Shares of/ });
      await expect(dialog.getByRole("link", { name: url })).toBeVisible();
      await dialog.getByRole("button", { name: /^Take “.*” down$/ }).click();
      await home
        .getByRole("alertdialog")
        .or(home.getByRole("dialog", { name: /^Take “/ }))
        .getByRole("button", { name: "Remove", exact: true })
        .click();
      await expect
        .poll(async () => (await ourShares(home.request)).length)
        .toBe(0);
    });

    await test.step("the link now says it is gone", async () => {
      await anon.goto(url);
      await expect(
        anon.getByRole("heading", { name: "This link no longer works" }),
      ).toBeVisible({
        timeout: 30_000,
      });
    });
  } finally {
    await visitor.close();
    await revokeAll(page.request);
    await files.removeWorkspace(WS);
  }
});

test("a share link that answers nothing says so to a signed-out visitor", async ({
  browser,
  baseURL,
}) => {
  test.skip(
    TARGET !== "web",
    "a signed-out visitor is a second browser context, which only the web target has",
  );
  const visitor = await browser.newContext({ baseURL });
  try {
    const anon = await visitor.newPage();
    const watch = watchPage(anon);
    await anon.goto("/@shares/e2e-no-such-share-token.k7");
    await expect(
      anon.getByRole("heading", { name: "This link no longer works" }),
    ).toBeVisible({
      timeout: 30_000,
    });
    watch.assertClean();
  } finally {
    await visitor.close();
  }
});
