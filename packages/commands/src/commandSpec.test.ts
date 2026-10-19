import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc, TrackDoc } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  ARG_KIND_NAMES,
  argClass,
  argHint,
  completions,
  loadCommandSpecs,
  MENU_ENTITIES,
  validateArgs,
} from "./commandSpec";
import type { CommandHost } from "./commands";
import { ARG_CLASSES, PROVIDER_NAMES } from "./providers";

// A host exposing the given track ids and nothing else: completion calls no engine op.
function host(trackIds: string[]): CommandHost {
  const tracks: TrackDoc[] = trackIds.map((id) => trackDoc(id));
  const project = (): ProjectDoc => emptyDoc({ name: "test", tracks });
  return {
    songPath: "",
    project,
    baseModules: [],
    log: () => {},
    refuse: () => {},
    reload: () => {},
    transport: () => {},
    arm: async () => undefined,
    applyProject: () => {},
    sendProject: () => {},
    listPlugins: () => {},
    rescanPlugins: () => {},
    showNativePluginUI: () => {},
    getPlugins: async () => [],
  };
}

describe("completions (against the real commands.yaml)", () => {
  it("completes a partial command to the matching command names", () => {
    const got = completions("system plugins ", host([]), "cli").sort();
    expect(got).toEqual(["system plugins list", "system plugins scan"]);
  });

  it("uses the LONGEST matching command so `track mute` isn't shadowed by a shorter one", () => {
    // No name prefixes another today, so this guards the rule — see docs/completions.md.
    const got = completions("track mute ", host(["melody", "bass"]), "cli");
    expect(got).toEqual(["track mute melody", "track mute bass"]);
  });

  it("never suggests an `@engine` ref for a module to inherit — only `module own` does", () => {
    const h = {
      ...host([]),
      baseModules: ["@engine/mu-tides", "@k7-core/instruments/mu-tides"],
    };
    // An engine ref is what a LIBRARY extends; a node reaches it through that library's module.
    expect(completions("node replace lead ", h, "cli")).toEqual([
      "node replace lead @k7-core/instruments/mu-tides",
    ]);
    expect(completions("module own ", h, "cli")).toEqual([
      "module own @engine/mu-tides",
    ]);
  });

  it("filters the arg provider by the partial token, case-insensitively", () => {
    const got = completions("track mute ME", host(["melody", "bass"]), "cli");
    expect(got).toEqual(["track mute melody"]);
  });
});

// The palette fills one field at a time, and the two ends must agree — docs/completions.md.
describe("the palette's one-field view of completions()", () => {
  // Verbatim from App.completeArg (minus the local-only special cases).
  const completeArg = (
    canonical: string,
    priorArgs: string[],
    partial: string,
    tracks: string[] = [],
  ): string[] => {
    const line = [canonical, ...priorArgs, partial].join(" ");
    const full = completions(line, host(tracks), "cli");
    const prefix = `${[canonical, ...priorArgs].join(" ")} `;
    return [
      ...new Set(
        full
          .map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : ""))
          .filter((v) => v),
      ),
    ];
  };

  it("offers an argument's values as soon as its field opens (empty partial)", () => {
    // The line has to keep the empty partial so it ends with a SPACE — docs/completions.md.
    expect(completeArg("track order", [], "", ["melody", "bass"])).toEqual([
      "melody",
      "bass",
    ]);
  });

  it("works for a MULTI-WORD command name", () => {
    // The regression: the value was pulled out by token INDEX — see docs/completions.md.
    expect(completeArg("track mute", [], "", ["melody"])).toEqual(["melody"]);
    expect(completeArg("module new", [], "")).toContain("instruments/");
    expect(completeArg("node new", [], "")).toContain("instruments/");
  });

  it("narrows as the field is typed into", () => {
    expect(completeArg("track mute", [], "me", ["melody", "bass"])).toEqual([
      "melody",
    ]);
  });

  it("offers nothing for an argument with no vocabulary", () => {
    expect(completeArg("track order", ["melody"], "", ["melody"])).toEqual([]); // the position
    expect(completeArg("node new", ["instruments/synth"], "")).toEqual([]); // the node name
  });
});

describe("node new", () => {
  it("is a verb of its own, not one of `module`'s", () => {
    // A node is its own thing, so `module ` offers none of its verbs.
    expect(completions("node ", host([]), "cli")).toContain("node new");
    expect(completions("module ", host([]), "cli")).not.toContain("node new");
  });

  it("completes its category/name arg", () => {
    // The static category provider, which lands you right after the slash.
    expect(completions("node new inst", host([]), "cli")).toEqual([
      "node new instruments/",
    ]);
    // The node name is free text — nothing to complete against.
    expect(completions("node new instruments/synth ", host([]), "cli")).toEqual(
      [],
    );
  });
});

describe("commands.yaml is well-formed against the providers", () => {
  it("names only providers that exist", () => {
    // The guard the TYPE can't give: the loader drops an unknown one, this fails the build.
    const bad = loadCommandSpecs().flatMap((c) =>
      (c.args ?? [])
        .filter((a) => a.complete && !PROVIDER_NAMES.has(a.complete))
        .map((a) => `${c.command} <${a.name}>: ${a.complete}`),
    );
    expect(bad).toEqual([]);
  });

  it("gives every argument at most one vocabulary", () => {
    // `complete` and `values` answer one question; both would make the winner an implementation detail.
    const both = loadCommandSpecs().flatMap((c) =>
      (c.args ?? [])
        .filter((a) => a.complete && a.values)
        .map((a) => `${c.command} <${a.name}>`),
    );
    expect(both).toEqual([]);
  });

  it("gives every typed argument a known shape", () => {
    const bad = loadCommandSpecs().flatMap((c) =>
      (c.args ?? [])
        .filter((a) => a.type && !ARG_KIND_NAMES.has(a.type))
        .map((a) => `${c.command} <${a.name}>: ${a.type}`),
    );
    expect(bad).toEqual([]);
  });

  it("only types arguments that are a single token", () => {
    // A typed argument is matched POSITIONALLY — see docs/completions.md.
    const spec = (name: string) =>
      loadCommandSpecs().find((c) => c.command === name);
    // Only the timecode carries a type here: `<name>` may contain spaces.
    expect(spec("project marker new")?.args?.map((a) => a.type)).toEqual([
      "timecode",
      undefined,
    ]);
    expect(
      validateArgs(spec("project marker new")!, "5:1:1 Verse two"),
    ).toBeNull();
    // `node param` is re-split by its handler (a param name has spaces), so nothing in it is typed.
    expect((spec("node param")?.args ?? []).every((a) => !a.type)).toBe(true);
  });

  it("refuses a malformed scalar before the handler runs", () => {
    const specs = loadCommandSpecs();
    const of = (name: string) => specs.find((c) => c.command === name)!;
    expect(validateArgs(of("project marker new"), "xyz Chorus")).toMatch(
      /bar:beat/,
    );
    expect(validateArgs(of("event trim"), "vox 24:1 abc")).toMatch(/a number/);
    expect(validateArgs(of("sequence note new"), "melody H9 4 6")).toMatch(
      /note name/,
    );
    // The offending token appears in the message, so the palette can point at it.
    expect(validateArgs(of("event trim"), "vox 24:1 left")).toContain('"left"');
  });

  it("accepts every shape its handlers accept", () => {
    const specs = loadCommandSpecs();
    const of = (name: string) => specs.find((c) => c.command === name)!;
    for (const tc of ["5", "5:1", "5:1:1"])
      expect(validateArgs(of("project marker new"), `${tc} Chorus`)).toBeNull();
    // A trim gate is in dB, so a negative number is the ordinary case rather than an edge.
    expect(validateArgs(of("event trim"), "vox 24:1 -6.5")).toBeNull();
    expect(validateArgs(of("sequence note new"), "melody F#3 0 1")).toBeNull();
    expect(validateArgs(of("sequence note new"), "melody 60 0 1")).toBeNull();
    // Too few arguments is the handler's message to give, not a shape error.
    expect(validateArgs(of("event move"), "drums")).toBeNull();
  });

  it("classes every argument, and says the same thing on the wire", () => {
    // An argument with no class would be an uncoloured hole in the line.
    for (const c of loadCommandSpecs())
      for (const a of c.args ?? [])
        expect(ARG_CLASSES, `${c.command} <${a.name}>`).toContain(argClass(a));

    // web-protocol/commandTypes.ts writes the same list out for the browser — docs/completions.md.
    const contract = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../web-protocol/commandTypes.ts",
      ),
      "utf8",
    );
    const union = contract.match(/export type ArgClass =([\s\S]*?);/)?.[1];
    expect(
      union,
      "ArgClass not found in web-protocol/commandTypes.ts",
    ).toBeTruthy();
    expect([...union!.matchAll(/"([a-z]+)"/g)].map((m) => m[1])).toEqual([
      ...ARG_CLASSES,
    ]);
  });

  it("names every completion provider on the wire too", () => {
    // A provider added here and not there is one k7's right-click menu can never see.
    const contract = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../web-protocol/commandTypes.ts",
      ),
      "utf8",
    );
    const union = contract.match(/export type ArgProvider =([\s\S]*?);/)?.[1];
    expect(
      union,
      "ArgProvider not found in web-protocol/commandTypes.ts",
    ).toBeTruthy();
    const onWire = [...union!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(onWire.slice().sort()).toEqual([...PROVIDER_NAMES].sort());
  });

  it("names every right-click menu on the wire too, and knows every word the catalogue uses", () => {
    // An unknown `menu:` word is dropped at load, silently as far as a menu is concerned — so it is checked here.
    const raw = parseYaml(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "../commands.yaml"),
        "utf8",
      ),
    ) as { command?: string; menu?: unknown }[];
    const unknown = raw.flatMap((c) =>
      (Array.isArray(c.menu) ? c.menu : [])
        .map(String)
        .filter((w) => !MENU_ENTITIES.includes(w as never))
        .map((w) => `${c.command}: ${w}`),
    );
    expect(unknown).toEqual([]);

    // k7's right-click reads the same list off the wire — an entity added here and not there can name no menu.
    const contract = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../web-protocol/commandTypes.ts",
      ),
      "utf8",
    );
    const list = contract.match(
      /export const MENU_ENTITIES = \[([\s\S]*?)\] as const;/,
    )?.[1];
    expect(
      list,
      "MENU_ENTITIES not found in web-protocol/commandTypes.ts",
    ).toBeTruthy();
    expect([...list!.matchAll(/"([a-z-]+)"/g)].map((m) => m[1])).toEqual([
      ...MENU_ENTITIES,
    ]);
  });

  it("tells you what every argument accepts", () => {
    // A free-text argument has to write its own `hint:`, because "text" answers nothing.
    const mute = loadCommandSpecs().flatMap((c) =>
      (c.args ?? [])
        .filter((a) => !argHint(a))
        .map((a) => `${c.command} <${a.name}>`),
    );
    expect(mute).toEqual([]);
  });

  it("names no YAML file in a hint or a help line, since a workspace file is .k7x", () => {
    const yaml = loadCommandSpecs().flatMap((c) =>
      [c.help ?? "", ...(c.args ?? []).map((a) => a.hint ?? "")]
        .filter((s) => /\.ya?ml\b/.test(s))
        .map((s) => `${c.command}: ${s}`),
    );
    expect(yaml).toEqual([]);
  });
});

// The catalogue is the only place that can notice a sentence is missing — docs/completions.md.
describe("readable descriptions", () => {
  const specs = loadCommandSpecs();

  it("exist in both languages for every command", () => {
    const missing = specs
      .filter((c) => !c.readable?.en?.trim() || !c.readable?.fr?.trim())
      .map((c) => c.command);
    expect(missing, "commands with no readable description").toEqual([]);
  });

  it("are sentences rather than the command name again", () => {
    // An echo of the name matches the same letters the name does — two rows saying one thing.
    const echoes = specs
      .filter((c) => c.readable?.en.toLowerCase() === c.command.toLowerCase())
      .map((c) => c.command);
    expect(echoes).toEqual([]);
    for (const c of specs) {
      expect(c.readable?.en.length, c.command).toBeGreaterThan(8);
      expect(c.readable?.fr.length, c.command).toBeGreaterThan(8);
    }
  });

  it("fit on the palette's row — 60 characters at most, in both languages", () => {
    // A longer sentence is not a longer row but a truncated one — see docs/completions.md.
    const long = specs.flatMap((c) =>
      (["en", "fr"] as const)
        .filter((lang) => (c.readable?.[lang] ?? "").length > 60)
        .map(
          (lang) =>
            `${c.command} (${lang}, ${c.readable?.[lang].length}): ${c.readable?.[lang]}`,
        ),
    );
    expect(long, "readable descriptions over 60 characters").toEqual([]);
  });

  it("carry no example and no full stop, unlike `help`", () => {
    // `help` is the CLI's fuller line; this one is scanned in a list — docs/completions.md.
    for (const c of specs)
      for (const text of [c.readable?.en ?? "", c.readable?.fr ?? ""]) {
        expect(text, c.command).not.toMatch(/e\.g\.|\(ex/i);
        expect(text, c.command).not.toMatch(/\.$/);
      }
  });

  it("say a different thing for every command", () => {
    // Two commands with one sentence are two rows a person cannot choose between.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const c of specs) {
      const key = (c.readable?.en ?? "").toLowerCase();
      const first = seen.get(key);
      if (first) clashes.push(`${first} / ${c.command}`);
      else seen.set(key, c.command);
    }
    expect(clashes).toEqual([]);
  });
});
