// auth.setup.ts — signs the e2e account in once and saves the browser state every web spec starts from.
import { expect, test as setup } from "@playwright/test";
import { AUTH_STATE } from "../src/paths.ts";
import { E2E_USER, sessionCookies } from "../src/session.ts";

setup("sign in as the e2e account", async ({ context, page, baseURL }) => {
  if (!baseURL) throw new Error("no baseURL");
  await context.addCookies(sessionCookies(baseURL));
  const me = await page.request.get("/auth/me");
  expect(
    me.status(),
    "the instance refused the minted session: wrong SESSION_SECRET?",
  ).toBe(200);
  expect((await me.json()).user.sub).toBe(E2E_USER.sub);
  await context.storageState({ path: AUTH_STATE });
});
