// aiOrganize.ts — the module builder's "AI organize": the one route that holds a Claude key.
// The browser sends the module (params, current panel, screens); this asks Claude for a whole
// new panel, CHECKS it with the builder's own rules and hands the model its mistakes once
// before giving up. The answer streams as NDJSON so a minute of thinking keeps the socket busy
// and the button can say what is happening. Off unless ANTHROPIC_API_KEY is set.
// Rationale: packages/ui-module-builder/docs/aiOrganize.md.

import Anthropic from "@anthropic-ai/sdk";
import { defineEnv, z } from "@frediverse/env";
import {
  AI_RESULT_SCHEMA,
  type AiOrganizeEvent,
  type AiOrganizeRequest,
  aiUserPrompt,
  checkAiResult,
  readAiAnswer,
} from "@studio/ui-module-builder/ai-organize";
import { aiSystemPrompt } from "@studio/ui-module-builder/ai-prompt";
import express, { type RequestHandler } from "express";

const env = defineEnv(
  {
    ANTHROPIC_API_KEY: z.string().optional(),
    // Not ANTHROPIC_MODEL: a developer's shell sets that for their own tools, often to an alias the API refuses.
    ST0_AI_MODEL: z.string().optional(),
  },
  { service: "st0-backend" },
);

const MODEL = env.ST0_AI_MODEL || "claude-opus-5";

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

const requestSchema = z.object({
  module: z.string().min(1),
  moduleYaml: z.string(),
  params: z.array(paramSchema).max(2000),
  uiYaml: z.string(),
  widgetsJs: z.string(),
  direction: z.string().max(2000),
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
  req: AiOrganizeRequest,
  say: (e: AiOrganizeEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const names = req.params.map((p) => p.name);
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
        model: MODEL,
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
          ...(MODEL.includes("haiku") ? {} : { effort: "high" as const }),
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
      issues = checkAiResult(answer, names).issues;
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

/** `GET` says whether the button should exist; `POST` runs one organize and streams NDJSON. */
export function aiOrganizeRouter(requireAuth: RequestHandler): express.Router {
  const router = express.Router();
  const client = env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    : null;

  router.get("/organize", requireAuth, (_req, res) => {
    res.json({ enabled: !!client, model: client ? MODEL : null });
  });

  router.post("/organize", requireAuth, async (req, res) => {
    if (!client) {
      res
        .status(404)
        .json({ error: "AI organize is not configured (ANTHROPIC_API_KEY)" });
      return;
    }
    const body = requestSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    const say = (e: AiOrganizeEvent) =>
      void (res.destroyed || res.write(`${JSON.stringify(e)}\n`));
    // A closed tab stops the request rather than paying for a panel nobody will see.
    const abort = new AbortController();
    res.on("close", () => res.writableEnded || abort.abort());
    try {
      await organize(client, body.data, say, abort.signal);
    } catch (e) {
      const error =
        e instanceof Anthropic.APIError
          ? `Claude API: ${e.message}`
          : (e as Error).message;
      say({ type: "error", error });
    }
    res.end();
  });
  return router;
}
