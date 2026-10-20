// The generated table is JSON cast to its type: this is the check the cast skips.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BUILTIN_PLUGINS,
  builtinParamAutomatable,
  builtinParamsFor,
} from "./builtinParams";

const param = z
  .object({
    name: z.string().min(1),
    min: z.number(),
    max: z.number(),
    def: z.number().optional(),
    states: z
      .array(z.object({ label: z.string(), value: z.number() }))
      .min(1)
      .optional(),
    automatable: z.literal(false).optional(),
  })
  .strict();

const plugin = z
  .object({
    name: z.string().min(1),
    role: z.enum(["instrument", "audioEffect", "midiEffect"]),
    params: z.array(param),
  })
  .strict();

describe("BUILTIN_PLUGINS", () => {
  it("matches the BuiltinPluginInfo shape, every entry", () => {
    const entries = Object.entries(BUILTIN_PLUGINS);
    expect(entries.length).toBeGreaterThan(100);
    for (const [type, info] of entries) {
      const parsed = plugin.safeParse(info);
      expect(parsed.success, `${type}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it("is read by the lookups", () => {
    expect(
      builtinParamsFor({ type: "internal", name: "4OSC" })?.length,
    ).toBeGreaterThan(0);
    expect(builtinParamAutomatable("4osc", "Voices 1")).toBe(false);
  });
});
