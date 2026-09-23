// settings.ts — the settings screen's three calls: read the slskd settings, save them, and test
// what is saved. Every secret goes in and never comes back out. See ../../docs/settings.md.

import { wrap } from "@frediverse/http/route";
import type { CheckResult, SlskdCheck } from "@studio/web-protocol/settings";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { message } from "../hunt/hunt.ts";
import { checkSftp } from "../hunt/sftp.ts";
import { checkSlskd } from "../hunt/slskd.ts";
import {
  readSettings,
  saveSettings,
  sftpOf,
  slskdOf,
} from "../settings/store.ts";

function subOf(req: Request): string | null {
  const u = (req as { user?: { sub?: string; email?: string } }).user;
  return u?.sub ?? u?.email ?? null;
}

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

/** One half of the test, its error flattened the way a hunt row's is. */
async function probe(
  run: (() => Promise<string>) | null,
): Promise<CheckResult> {
  if (!run) return { ok: false, detail: "incomplet" };
  try {
    return { ok: true, detail: await run() };
  } catch (e) {
    return { ok: false, detail: message(e) };
  }
}

export const settingsRouter: Router = Router();

settingsRouter.use((req, res, next) => {
  if (!subOf(req))
    return res.status(401).json({ error: "no user on the session" });
  next();
});

settingsRouter.get("/slskd", (req, res) => {
  res.json(readSettings(subOf(req) as string));
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
    const sub = subOf(req) as string;
    saveSettings(sub, parsed.data);
    res.json(readSettings(sub));
  }),
);

/** Tests what is SAVED, both halves at once, since each fails for reasons of its own. */
settingsRouter.post(
  "/slskd/check",
  wrap(async (req, res) => {
    const sub = subOf(req) as string;
    const slskd = slskdOf(sub);
    const sftp = sftpOf(sub);
    const [a, b] = await Promise.all([
      probe(slskd && (() => checkSlskd(slskd))),
      probe(sftp && (() => checkSftp(sftp))),
    ]);
    const out: SlskdCheck = { slskd: a, sftp: b };
    res.json(out);
  }),
);
