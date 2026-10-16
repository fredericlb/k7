import { describe, expect, it } from "vitest";
import { loadCommandSpecs, registerVerb } from "./commandSpec";
import { SID_HANDLERS, VERB_TABLES } from "./commands";

// commands.yaml names a `sid` and SID_HANDLERS holds it: a drift fails here, not at runtime.
describe("command registry integrity (commands.yaml <-> SID_HANDLERS)", () => {
  const specs = loadCommandSpecs();
  const yamlSids = [...new Set(specs.map((s) => s.sid))];

  it("loads the command specs", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it("every command's sid has a registered handler", () => {
    expect(yamlSids.filter((sid) => !(sid in SID_HANDLERS))).toEqual([]);
  });

  it("every builtin SID is registered by exactly one verb table", () => {
    const seen = new Map<string, number>();
    for (const table of VERB_TABLES)
      for (const sid of Object.keys(table))
        seen.set(sid, (seen.get(sid) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n !== 1)).toEqual([]);
    expect(yamlSids.filter((sid) => !seen.has(sid))).toEqual([]);
  });

  it("every registered handler is referenced by a command (no dead handlers)", () => {
    expect(
      Object.keys(SID_HANDLERS).filter((k) => !yamlSids.includes(k)),
    ).toEqual([]);
  });
});

// The PLUGIN seam: registerVerb installs both halves at once and refuses a taken word.
describe("registerVerb (a plugin's installer)", () => {
  const fresh = (word: string) => ({
    command: word,
    sid: "plugin.test.verb",
    surfaces: ["cli" as const],
  });

  it("installs both halves: the catalogue lists it and the SID dispatches", () => {
    const word = `plugin test verb ${Date.now()}`;
    registerVerb(
      {
        command: word,
        sid: `plugin.test.installed.${Date.now()}`,
        surfaces: ["cli"],
        help: "does nothing, loudly",
      },
      () => {},
    );
    const listed = loadCommandSpecs().find((c) => c.command === word);
    expect(listed).toBeTruthy();
    expect(SID_HANDLERS[listed!.sid]).toBeInstanceOf(Function);
  });

  it("refuses a command word a builtin already speaks for", () => {
    expect(() => registerVerb(fresh("track mute"), () => {})).toThrow(
      /already in the catalogue/,
    );
  });

  it("refuses a second registration of the same word — one word, one verb", () => {
    const word = `plugin test twice ${Date.now()}`;
    registerVerb(
      {
        command: word,
        sid: `plugin.test.twice.a.${Date.now()}`,
        surfaces: ["cli"],
      },
      () => {},
    );
    expect(() =>
      registerVerb(
        {
          command: word,
          sid: `plugin.test.twice.b.${Date.now()}`,
          surfaces: ["cli"],
        },
        () => {},
      ),
    ).toThrow(/already in the catalogue/);
  });

  it("refuses a SID a builtin handles without leaving a catalogue row behind", () => {
    const word = `plugin test clash ${Date.now()}`;
    expect(() =>
      registerVerb(
        { command: word, sid: "track.mute", surfaces: ["cli"] },
        () => {},
      ),
    ).toThrow(/already has a handler/);
    expect(loadCommandSpecs().some((c) => c.command === word)).toBe(false);
  });
});
