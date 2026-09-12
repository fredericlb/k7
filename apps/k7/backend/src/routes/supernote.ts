/* Supernote sync: the settings screen's four calls — read the state, activate, switch
   off, and force a run. The password goes in and never comes back out.
*/

import { sub, validate, wrap } from "@frediverse/http";
import { Router } from "express";
import { z } from "zod";
import { login } from "../supernote/client.ts";
import { disable, readStatus, saveConfig } from "../supernote/config.ts";
import { isRunning, syncSongbook } from "../supernote/sync.ts";

export const supernoteRouter = Router();

const activateSchema = z.object({
  baseUrl: z.string({ error: "an address is required" }).trim().url(),
  account: z.string({ error: "an account is required" }).trim().min(1),
  password: z.string({ error: "a password is required" }).min(1),
});

const state = async (req) => ({
  ...(await readStatus(sub(req))),
  syncing: isRunning(sub(req)),
});

supernoteRouter.get(
  "/",
  wrap(async (req, res) => {
    res.json(await state(req));
  }),
);

supernoteRouter.put(
  "/",
  validate(activateSchema),
  wrap(async (req, res) => {
    const { baseUrl, account, password } = req.body;
    // Signing in first: credentials that do not work are refused rather than stored.
    await login(baseUrl, account, password);
    await saveConfig(sub(req), { enabled: true, baseUrl, account, password });
    res.json({ ...(await state(req)), syncing: true });
    // The first run starts here and is watched through GET, not awaited by the button.
    void syncSongbook(sub(req)).catch(() => {});
  }),
);

supernoteRouter.delete(
  "/",
  wrap(async (req, res) => {
    await disable(sub(req));
    res.json(await state(req));
  }),
);

supernoteRouter.post(
  "/sync",
  wrap(async (req, res) => {
    if (isRunning(sub(req)))
      return res.status(409).json({ error: "already running" });
    res.status(202).json({ ...(await state(req)), syncing: true });
    void syncSongbook(sub(req)).catch(() => {});
  }),
);
