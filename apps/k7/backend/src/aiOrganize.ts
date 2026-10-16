// aiOrganize.ts — the module builder's "AI organize", with the ACCOUNT's Claude key and model
// (aiSettings.ts). The browser sends the module (params, current panel, screens); this asks
// Claude for a whole new panel, CHECKS it with the builder's own rules and hands the model its
// mistakes once before giving up. The answer streams as NDJSON so a minute of thinking keeps
// the socket busy and the button can say what is happening. Off for an account with no key.
// Rationale: packages/ui-module-builder/docs/aiOrganize.md.

import Anthropic from "@anthropic-ai/sdk";
import {
  AI_RESULT_SCHEMA,
  type AiOrganizeEvent,
  type AiOrganizeRequest,
  aiUserPrompt,
  bindableNames,
  checkAiResult,
  readAiAnswer,
} from "@studio/panel-rules/ai-organize";
import { aiSystemPrompt } from "@studio/panel-rules/ai-prompt";
import type { PrefsStore } from "@studio/user-prefs";
import express, { type RequestHandler } from "express";
import { z } from "zod";
import {
  type AiSettings,
  aiSettingsRoutes,
  DEFAULT_AI_MODEL,
} from "./aiSettings";

/** One proposal and one repair: a second round of the same mistakes is not worth a third minute. */
const ROUNDS = 2;

const paramSchema = z.object({
  name: z.string().min(1),
  meta: z
    .object({
      min: z.number(),
      max: z.number(),
      def: z.number().optional(),
      states: z
        .array(z.object({ label: z.string(), value: z.number() }))
        .optional(),
    })
    .optional(),
  value: z.string().optional(),
});

const requestSchema = z
  .object({
    module: z.string().min(1),
    moduleYaml: z.string(),
    params: z.array(paramSchema).max(2000),
    uiYaml: z.string(),
    widgetsJs: z.string(),
    mode: z.enum(["update", "reset"]),
    direction: z.string().max(2000),
  })
  // An update with nothing to change would pay a minute of the account's Claude for the panel it has.
  .refine((r) => r.mode !== "update" || r.direction.trim() !== "", {
    message: "an update says what should change",
    path: ["direction"],
  }) satisfies z.ZodType<AiOrganizeRequest>;

/** The text of a finished turn, or why there is none — a refusal and a cut-off say different things. */
function answerText(msg: Anthropic.Message): string {
  if (msg.stop_reason === "refusal")
    throw new Error(
      `Claude declined${msg.stop_details?.explanation ? `: ${msg.stop_details.explanation}` : ""}`,
    );
  if (msg.stop_reason === "max_tokens")
    throw new Error("the answer ran past the output limit");
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Ask, check, and hand back the mistakes once; `say` reports progress to the browser. */
async function organize(
  client: Anthropic,
  model: string,
  req: AiOrganizeRequest,
  say: (e: AiOrganizeEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const names = bindableNames(req);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: aiUserPrompt(req) },
  ];
  let issues: string[] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    say({
      type: "status",
      text:
        round === 1
          ? "Claude is designing the panel…"
          : "Claude is fixing the panel…",
    });
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 64000,
        // The stable half is cached: a second click on another module re-reads only the module.
        system: [
          {
            type: "text",
            text: aiSystemPrompt(),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
        output_config: {
          // Haiku takes no effort setting; every other current model thinks harder for `high`.
          ...(model.includes("haiku") ? {} : { effort: "high" as const }),
          format: { type: "json_schema", schema: AI_RESULT_SCHEMA },
        },
      },
      { signal },
    );
    let chars = 0;
    let last = 0;
    stream.on("text", (delta) => {
      chars += delta.length;
      if (chars - last < 2000) return;
      last = chars;
      say({
        type: "status",
        text: `Writing… ${Math.round(chars / 1000)}k characters`,
      });
    });
    const msg = await stream.finalMessage();
    const answer = readAiAnswer(answerText(msg));
    if (!answer) {
      issues = ["the answer was not the JSON object asked for"];
    } else {
      issues = checkAiResult(answer, names, req).issues;
      if (!issues.length) return say({ type: "done", result: answer });
    }
    // The whole turn goes back, thinking included, so the repair reasons from what it did.
    messages.push(
      { role: "assistant", content: msg.content },
      {
        role: "user",
        content: `The panel was refused:\n${issues.map((i) => `- ${i}`).join("\n")}\n\nReturn the whole corrected answer.`,
      },
    );
  }
  say({
    type: "error",
    error: "Claude's panel did not pass the checks",
    issues,
  });
}

/** Its own body limit, mounted BEFORE the app's parser: a big plugin's params outgrow the default 100 kB. */
export const aiOrganizeBody = express.json({ limit: "2mb" });

/** `/settings` is the account's key and model; `GET /organize` says whether the button should exist; `POST` runs one. */
export function aiOrganizeRouter(
  store: PrefsStore<AiSettings>,
  requireAuth: RequestHandler,
): express.Router {
  const router = express.Router();
  router.use(aiSettingsRoutes(store, requireAuth));
  // Read per request: a key set in the panel a second ago is the one this click uses.
  const settingsOf = (req: express.Request) =>
    req.user?.sub ? store.read(req.user.sub) : null;

  router.get("/organize", requireAuth, (req, res) => {
    const s = settingsOf(req);
    res.json({
      enabled: !!s?.apiKey,
      model: s?.apiKey ? s.model || DEFAULT_AI_MODEL : null,
    });
  });

  router.post("/organize", requireAuth, async (req, res) => {
    const s = settingsOf(req);
    if (!s?.apiKey) {
      res.status(404).json({
        error: "no Claude key for this account — set one in the settings panel",
      });
      return;
    }
    const body = requestSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    let lastStatus: AiOrganizeEvent | null = null;
    const say = (e: AiOrganizeEvent) => {
      if (e.type === "status") lastStatus = e;
      void (res.destroyed || res.write(`${JSON.stringify(e)}\n`));
    };
    // Thinking writes nothing for minutes; the last status again keeps an idle-timing proxy from cutting the stream.
    const heartbeat = setInterval(() => lastStatus && say(lastStatus), 15_000);
    // A closed tab stops the request rather than paying for a panel nobody will see.
    const abort = new AbortController();
    res.on("close", () => res.writableEnded || abort.abort());
    try {
      const client = new Anthropic({ apiKey: s.apiKey });
      await organize(
        client,
        s.model || DEFAULT_AI_MODEL,
        body.data,
        say,
        abort.signal,
      );
    } catch (e) {
      const error =
        e instanceof Anthropic.APIError
          ? `Claude API: ${e.message}`
          : (e as Error).message;
      say({ type: "error", error });
    } finally {
      clearInterval(heartbeat);
    }
    res.end();
  });
  return router;
}
