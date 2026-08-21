import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDoc, trackDoc } from "@studio/engine-protocol/build";
import type { ProjectDoc, TrackDoc } from "@studio/song/project";
import { describe, expect, it } from "vitest";
import {
  ARG_CLASSES,
  ARG_KIND_NAMES,
  argClass,
  argHint,
  completions,
  loadCommandSpecs,
  PROVIDER_NAMES,
  validateArgs,
} from "./commandSpec";
import type { CommandHost } from "./commands";

// A host whose project just exposes the given track ids — enough for the `tracks`
// completion provider (it reads `project().tracks.map(t => t.id)`). Every engine op
// is a no-op; completion never calls them.
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
    // Getting track-completed lines proves the full `track mute` won rather than
    // some shorter prefix. No command name prefixes another today — `system channel set`
    // closed the last one — so this guards the rule, not a live collision.
    const got = completions("track mute ", host(["melody", "bass"]), "cli");
    expect(got).toEqual(["track mute melody", "track mute bass"]);
  });

  it("filters the arg provider by the partial token, case-insensitively", () => {
    const got = completions("track mute ME", host(["melody", "bass"]), "cli");
    expect(got).toEqual(["track mute melody"]);
  });
});

// The command palette fills one field at a time, so it asks for the values of ONE
// argument and gets whole runnable lines back. This mirrors what web/frontend's
// App.completeArg does with them — the two ends have to agree, and they didn't:
// the palette offered COMMAND NAMES where it should have offered values.
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
    // The line has to keep the empty partial so it ends with a SPACE — that space is
    // what tells completions() the command is settled and its args are being filled.
    // Dropping it left the bare command name, which reads as "still typing a name".
    expect(
      completeArg("track take select", [], "", ["melody", "bass"]),
    ).toEqual(["melody", "bass"]);
  });

  it("works for a MULTI-WORD command name", () => {
    // The regression: the value was pulled out by token INDEX, which assumed the
    // command was one word — so "track mute melody" handed back "mute", and the
    // palette looked like it was completing commands instead of arguments.
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
    expect(
      completeArg("track take select", ["melody"], "", ["melody"]),
    ).toEqual([]); // the take number
    expect(completeArg("node new", ["instruments/synth"], "")).toEqual([]); // the node name
  });
});

describe("node new", () => {
  it("is a verb of its own, not one of `module`'s", () => {
    // It was `module instance new`, and the test here was that the shared `module ` prefix did
    // not shadow `module new`. There is no shared prefix any more: a node is its own thing, so
    // its verbs sit at the top level and `module ` offers none of them.
    expect(completions("node ", host([]), "cli")).toContain("node new");
    expect(completions("module ", host([]), "cli")).not.toContain("node new");
  });

  it("completes its category/name arg", () => {
    // The static category provider, the same one `new module` uses — it lands you
    // right after the slash, ready to type the module's name.
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
    // The guard the TYPE can't give us: commands.yaml is parsed at runtime, so a typo
    // in `complete:` used to survive as an argument that silently completed nothing.
    // The loader drops an unknown one (and logs); this fails the build instead.
    const bad = loadCommandSpecs().flatMap((c) =>
      (c.args ?? [])
        .filter((a) => a.complete && !PROVIDER_NAMES.has(a.complete))
        .map((a) => `${c.command} <${a.name}>: ${a.complete}`),
    );
    expect(bad).toEqual([]);
  });

  it("gives every argument at most one vocabulary", () => {
    // `complete` and `values` answer the same question; carrying both would make which
    // one wins an implementation detail of completions().
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
    // A typed argument is matched POSITIONALLY, so it must not be one that swallows the
    // rest of the line — those are always last, and anything after them is free text.
    const spec = (name: string) =>
      loadCommandSpecs().find((c) => c.command === name);
    // `project marker new <timecode> <name>`: the name may contain spaces, so only the timecode
    // carries a type, and a spaced name must not make the timecode fail.
    expect(spec("project marker new")?.args?.map((a) => a.type)).toEqual([
      "timecode",
      undefined,
    ]);
    expect(
      validateArgs(spec("project marker new")!, "5:1:1 Verse two"),
    ).toBeNull();
    // `node param <node> <param> <value>` is re-split by its handler (a param name
    // has spaces), so nothing in it is typed.
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
    // Negative and fractional numbers, notes as names or as MIDI numbers. A trim gate is in dB,
    // so a negative one is the ordinary case rather than an edge.
    expect(validateArgs(of("event trim"), "vox 24:1 -6.5")).toBeNull();
    expect(validateArgs(of("sequence note new"), "melody F#3 0 1")).toBeNull();
    expect(validateArgs(of("sequence note new"), "melody 60 0 1")).toBeNull();
    // Too few arguments is the handler's message to give, not a shape error.
    expect(validateArgs(of("event move"), "drums")).toBeNull();
  });

  it("classes every argument, and says the same thing on the wire", () => {
    // The palette colours a field by its class, so an argument with no class would be
    // an uncoloured hole in the line.
    for (const c of loadCommandSpecs())
      for (const a of c.args ?? [])
        expect(ARG_CLASSES, `${c.command} <${a.name}>`).toContain(argClass(a));

    // web-protocol/types.ts writes the same list out for the browser (which can't import
    // this module — it reads commands.yaml off disk). Adding a class here without adding
    // it there would ship a kind the palette has no colour for.
    const contract = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../web-protocol/types.ts",
      ),
      "utf8",
    );
    const union = contract.match(/export type ArgClass =([\s\S]*?);/)?.[1];
    expect(union, "ArgClass not found in web-protocol/types.ts").toBeTruthy();
    expect([...union!.matchAll(/"([a-z]+)"/g)].map((m) => m[1])).toEqual([
      ...ARG_CLASSES,
    ]);
  });

  it("names every completion provider on the wire too", () => {
    // A class says what COLOUR a field is; the provider says what the argument actually names,
    // and that is what st0's right-click menu matches on to offer a track its own commands and
    // not a sequence's. A provider added here and not there is one the menu can never see.
    const contract = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../web-protocol/types.ts",
      ),
      "utf8",
    );
    const union = contract.match(/export type ArgProvider =([\s\S]*?);/)?.[1];
    expect(
      union,
      "ArgProvider not found in web-protocol/types.ts",
    ).toBeTruthy();
    const onWire = [...union!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(onWire.slice().sort()).toEqual([...PROVIDER_NAMES].sort());
  });

  it("tells you what every argument accepts", () => {
    // The palette shows this clue beside the field. A provider-backed or scalar argument
    // gets one for free; a free-text one has to write its own `hint`, because "text" on
    // its own answers nothing — which is exactly the field you'd otherwise have to run
    // the command to understand.
    const mute = loadCommandSpecs().flatMap((c) =>
      (c.args ?? [])
        .filter((a) => !argHint(a))
        .map((a) => `${c.command} <${a.name}>`),
    );
    expect(mute).toEqual([]);
  });
});

/**
 * The palette LISTS these sentences and matches on them, so a command without one is a command
 * nobody can find by describing what they want — which is the whole point of the surface. The
 * catalogue is the only place that knows a command exists, so it is the only place that can
 * notice the sentence is missing.
 */
describe("readable descriptions", () => {
  const specs = loadCommandSpecs();

  it("exist in both languages for every command", () => {
    const missing = specs
      .filter((c) => !c.readable?.en?.trim() || !c.readable?.fr?.trim())
      .map((c) => c.command);
    expect(missing, "commands with no readable description").toEqual([]);
  });

  it("are sentences rather than the command name again", () => {
    // A description that merely echoes the name teaches nothing and matches the same letters
    // the name already matches — two rows saying one thing.
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
    // The row is `sentence … name`, and the name has to stay readable at the right of it. A
    // longer sentence is not a longer row: it is a truncated one, or a list that wraps into a
    // wall over the minimap. The cap is also what keeps a description from drifting back into
    // `help` — every line that ran past it was carrying a caveat or an example, not an action.
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
    // `help` is the CLI's fuller line and carries "(e.g. …)"; this one is scanned in a list,
    // where an example is noise and a trailing stop is a row of ragged dots.
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
