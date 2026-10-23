// settings.ts — the server page's calls: whether the session is an admin, which anyone signed in may
// ask, then reading, saving and testing the slskd settings, admins only. Every secret goes in and
// never comes back out — not even as an error's text. See ../../../docs/media/settings.md.

import { wrap } from "@frediverse/http/route";
import type { CheckResult, SlskdCheck } from "@studio/web-protocol/settings";
import { Router } from "express";
import { z } from "zod";
import { subjectOf } from "../../who.ts";
import { isAdminRequest } from "../admin.ts";
import { checkSftp } from "../hunt/sftp.ts";
import { checkSlskd } from "../hunt/slskd.ts";
import {
  readSettings,
  saveSettings,
  sftpOf,
  slskdOf,
} from "../settings/store.ts";

// Empty is allowed on every plain field: saving half a form is how a form gets filled in.
const inputSchema = z.object({
  url: z.union([z.literal(""), z.string().trim().url()]),
  sftpHost: z.string().max(255),
  sftpPort: z.number().int().min(1).max(65535),
  sftpUser: z.string().max(255),
  downloadsDir: z.string().max(1024),
  apiKey: z.string().max(1024).optional(),
  sftpPassword: z.string().max(1024).optional(),
  sftpKey: z.string().max(16_384).optional(),
  sftpPassphrase: z.string().max(1024).optional(),
});

/** One half of the test; a failure answers a fixed word and logs the cause, so the test is no probe. */
async function probe(
  name: string,
  run: (() => Promise<string>) | null,
): Promise<CheckResult> {
  if (!run) return { ok: false, detail: "incomplet" };
  try {
    return { ok: true, detail: await run() };
  } catch (e) {
    console.error(`   settings check, ${name}: ${(e as Error).message}`);
    return {
      ok: false,
      detail: "échec de la connexion — voir le journal du serveur",
    };
  }
}

export const settingsRouter: Router = Router();

settingsRouter.use((req, res, next) => {
  if (!subjectOf(req))
    return res.status(401).json({ error: "no user on the session" });
  next();
});

// What the user menu asks before it offers the server page: the session's own standing, nothing more.
settingsRouter.get("/admin", (req, res) => {
  res.json({ admin: isAdminRequest(req) });
});

settingsRouter.use((req, res, next) => {
  if (!isAdminRequest(req))
    return res.status(403).json({ error: "admins only" });
  next();
});

settingsRouter.get("/slskd", (_req, res) => {
  res.json(readSettings());
});

settingsRouter.put(
  "/slskd",
  wrap((req, res) => {
    const parsed = inputSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        error: parsed.error.issues
          .map((i) => `${i.path.join(".")} : ${i.message}`)
          .join(", "),
      });
    saveSettings(parsed.data);
    res.json(readSettings());
  }),
);

/** Tests what is SAVED, both halves at once, since each fails for reasons of its own. */
settingsRouter.post(
  "/slskd/check",
  wrap(async (_req, res) => {
    const slskd = slskdOf();
    const sftp = sftpOf();
    const [a, b] = await Promise.all([
      probe("slskd", slskd && (() => checkSlskd(slskd))),
      probe("sftp", sftp && (() => checkSftp(sftp))),
    ]);
    const out: SlskdCheck = { slskd: a, sftp: b };
    res.json(out);
  }),
);
