// The publish tokens a user mints for `k7 export`: minted by POST (never GET, so no link or image can
// mint one), listed and revoked by their owner. Behind the cookie session: a token never mints another.
// Under /api/token/publish: the rest of /api/token is the media library's and falls through.

import { sub, wrap } from "@frediverse/http";
import { Router } from "express";
import { issueApiToken, listApiTokens, revokeApiToken } from "../apitoken.ts";

export const tokenRouter = Router();

type Listed = ReturnType<typeof listApiTokens>[number];
const shown = (r: Listed) => ({
  id: r.id,
  label: r.label,
  created: r.created,
  expires: r.expires,
  lastUsed: r.lastUsed ?? null,
});

tokenRouter.post(
  "/publish",
  wrap(async (req, res) => {
    const raw = (req.body as { label?: unknown } | undefined)?.label;
    const label =
      typeof raw === "string" && raw.trim() !== ""
        ? raw.trim().slice(0, 80)
        : "k7 export";
    const token = issueApiToken(sub(req), { label });
    const record = listApiTokens(sub(req)).at(-1);
    res.json({ token, ...(record ? shown(record) : {}) });
  }),
);

tokenRouter.get(
  "/publish",
  wrap(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ tokens: listApiTokens(sub(req)).map(shown) });
  }),
);

tokenRouter.delete(
  "/publish/:id",
  wrap(async (req, res) => {
    if (!revokeApiToken(sub(req), String(req.params.id))) {
      res.status(404).json({ error: "no such token" });
      return;
    }
    res.json({ ok: true });
  }),
);
