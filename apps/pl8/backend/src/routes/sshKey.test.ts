// Who may fetch the private half of the deploy key. The route alone, with the session faked
// ahead of it — what this pins is whose key comes back for which bearer, which is the whole of
// the decision recorded in ../../docs/sshKeyForService.md.

import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKey } from "@studio/git-repos/keys";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keyDirFor } from "../projects/store.ts";
import { projectsRouter } from "./projects.ts";

const ME = "3024473a-5924-420d-9db0-327c2d45212f"; // an OIDC sub, as an IdP hands it back
const MY_EMAIL = "fred@parapluie.org";
const OTHER = "9f1c0000-0000-4000-8000-000000000000";

let dir: string;
let server: Server;
let base: string;
/** Who the faked session is, per test. Null for the routes that need none. */
let session: { sub?: string; email?: string } | null;
/** What `verifyApiToken` says about a bearer — the test's whole token scheme. */
const tokens: Record<string, string> = {
  "machine-token": "service:l8",
  "my-token": ME,
  "other-token": OTHER,
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pl8-sshkey-"));
  process.env.STUDIO_PROJECTS_DIR = dir;
  session = { sub: ME, email: MY_EMAIL };
  const app = express();
  app.use((req, _res, next) => {
    if (session) (req as { user?: unknown }).user = session;
    next();
  });
  app.use(
    "/api/projects",
    projectsRouter({ verifyApiToken: (t) => tokens[t] ?? null }),
  );
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  delete process.env.STUDIO_PROJECTS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

/** Touch the projects section once, which is what records email → sub. */
const visit = () => fetch(`${base}/api/projects/revision`);

const fetchKey = (bearer: string, user?: string): Promise<Response> =>
  fetch(
    `${base}/api/projects/ssh-key/private${user === undefined ? "" : `?user=${encodeURIComponent(user)}`}`,
    { headers: { authorization: `Bearer ${bearer}` } },
  );

describe("the private half of the deploy key", () => {
  beforeEach(async () => {
    await generateKey(keyDirFor(ME), "studio-test");
  });

  it("gives a service token the key of the person it names", async () => {
    await visit(); // the machine knows an email; this is what maps it to the subject
    const res = await fetchKey("machine-token", MY_EMAIL);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { privateKey?: string };
    expect(body.privateKey).toContain("PRIVATE KEY");
  });

  it("matches the email whatever its case", async () => {
    await visit();
    expect((await fetchKey("machine-token", "Fred@Parapluie.ORG")).status).toBe(
      200,
    );
  });

  it("takes the subject itself, for an IdP that sends no email", async () => {
    const res = await fetchKey("machine-token", ME);
    expect(res.status).toBe(200);
  });

  it("refuses a service token that names nobody", async () => {
    const res = await fetchKey("machine-token");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/whose key/);
  });

  it("still answers an account token with its own key, unnamed", async () => {
    const res = await fetchKey("my-token");
    expect(res.status).toBe(200);
  });

  it("refuses an account token reaching for somebody else's", async () => {
    await visit();
    const res = await fetchKey("other-token", MY_EMAIL);
    expect(res.status).toBe(403);
  });

  it("lets an account token name ITSELF, by either spelling", async () => {
    await visit();
    expect((await fetchKey("my-token", MY_EMAIL)).status).toBe(200);
    expect((await fetchKey("my-token", ME)).status).toBe(200);
  });

  it("takes no session cookie in place of a bearer", async () => {
    const res = await fetch(`${base}/api/projects/ssh-key/private`);
    expect(res.status).toBe(401);
  });

  it("says the key is missing rather than inventing one", async () => {
    const res = await fetchKey("machine-token", "nobody@example.org");
    expect(res.status).toBe(404);
  });
});
