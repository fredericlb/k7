// aiSettings.ts — the account's Claude key and model, set from the settings panel and kept
// here, one small file per account beside the preferences. The one thing to get right: the KEY
// goes in and never comes back out — reads answer a masked hint, which is why this is not a
// field of the preferences document the browser reads whole and writes back whole.
// Rationale: packages/ui-module-builder/docs/aiOrganize.md.

import type { AiSettingsView } from "@studio/panel-rules/ai-organize";
import type { PrefsStore } from "@studio/user-prefs";
import express, { type RequestHandler } from "express";
import { z } from "zod";
import { subOf } from "./who.ts";

/** The model asked for when the account names none. */
export const DEFAULT_AI_MODEL = "claude-opus-5";

/** What is on disk for one account. */
export interface AiSettings {
  apiKey?: string;
  model?: string;
}

/** `sk-ant-…wxyz`: enough to tell two keys apart, not enough to use one. */
const hintOf = (key: string): string =>
  key.length > 16 ? `${key.slice(0, 7)}…${key.slice(-4)}` : "…";

const viewOf = (s: AiSettings | null): AiSettingsView => ({
  model: s?.model || null,
  defaultModel: DEFAULT_AI_MODEL,
  keyHint: s?.apiKey ? hintOf(s.apiKey) : null,
});

// A PATCH, unlike the preferences: the browser never holds the key, so it cannot send the whole document back.
const patchSchema = z
  .object({
    // Absent keeps the key, a string replaces it, null or "" removes it.
    apiKey: z.string().trim().nullable().optional(),
    // Absent keeps the model, a string sets it, null or "" goes back to the default.
    model: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

/** `GET`/`PUT /settings` over the store; mounted behind the host's requireAuth. */
export function aiSettingsRoutes(
  store: PrefsStore<AiSettings>,
  requireAuth: RequestHandler,
): express.Router {
  const router = express.Router();

  router.get("/settings", requireAuth, (req, res) => {
    const sub = subOf(req);
    if (!sub)
      return void res.status(401).json({ error: "no user on the session" });
    res.json(viewOf(store.read(sub)));
  });

  router.put("/settings", requireAuth, (req, res) => {
    const sub = subOf(req);
    if (!sub)
      return void res.status(401).json({ error: "no user on the session" });
    const patch = patchSchema.safeParse(req.body);
    if (!patch.success)
      return void res.status(400).json({
        error: patch.error.issues.map((i) => i.message).join("; "),
      });
    let current: AiSettings | null;
    try {
      current = store.readForUpdate(sub);
    } catch {
      // Merged onto {}, a model change would write the file back without its key.
      return void res.status(500).json({
        error: "the AI settings could not be read, so nothing was changed",
      });
    }
    const next: AiSettings = { ...(current ?? {}) };
    const { apiKey, model } = patch.data;
    if (apiKey !== undefined) next.apiKey = apiKey || undefined;
    if (model !== undefined) next.model = model || undefined;
    if (!store.write(sub, next))
      return void res
        .status(500)
        .json({ error: "the AI settings could not be stored" });
    res.json(viewOf(next));
  });

  return router;
}
