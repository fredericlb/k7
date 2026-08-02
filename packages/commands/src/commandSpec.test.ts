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
    const got = completions("module list ", host([]), "cli").sort();
    expect(got).toEqual(["module list plugins", "module list vst"]);
  });

  it("uses the LONGEST matching command so `track mute` isn't shadowed by a shorter one", () => {
    // Getting track-completed lines proves the full `track mute` won rather than
    // some shorter prefix. No command name prefixes another today — `channel set`
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
    expect(completeArg("track gain", [], "", ["melody", "bass"])).toEqual([
      "melody",
      "bass",
    ]);
  });

  it("works for a MULTI-WORD command name", () => {
    // The regression: the value was pulled out by token INDEX, which assumed the
    // command was one word — so "track mute melody" handed back "mute", and the
    // palette looked like it was completing commands instead of arguments.
    expect(completeArg("track mute", [], "", ["melody"])).toEqual(["melody"]);
    expect(completeArg("module new", [], "")).toContain("instruments/");
    expect(completeArg("module instance new", [], "")).toContain(
      "instruments/",
    );
  });

  it("narrows as the field is typed into", () => {
    expect(completeArg("track mute", [], "me", ["melody", "bass"])).toEqual([
      "melody",
    ]);
  });

  it("offers nothing for an argument with no vocabulary", () => {
    expect(completeArg("track gain", ["melody"], "", ["melody"])).toEqual([]); // the dB value
    expect(
      completeArg("module instance new", ["instruments/synth"], ""),
    ).toEqual([]); // the instance name
  });
});

describe("module instance new", () => {
  it("is offered alongside `module new` without either shadowing the other", () => {
    // Dispatch is longest-prefix on `command + " "`, so "module instance new …" is
    // never read as `module new` with an "instance …" argument — and typing
    // "module new" still offers the longer one.
    expect(completions("module ", host([]), "cli")).toContain(
      "module instance new",
    );
  });

  it("completes its category/name arg", () => {
    // The static category provider, the same one `new module` uses — it lands you
    // right after the slash, ready to type the module's name.
    expect(completions("module instance new inst", host([]), "cli")).toEqual([
      "module instance new instruments/",
    ]);
    // The instance name is free text — nothing to complete against.
    expect(
      completions("module instance new instruments/synth ", host([]), "cli"),
    ).toEqual([]);
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
    // `marker new <timecode> <name>`: the name may contain spaces, so only the timecode
    // carries a type, and a spaced name must not make the timecode fail.
    expect(spec("marker new")?.args?.map((a) => a.type)).toEqual([
      "timecode",
      undefined,
    ]);
    expect(validateArgs(spec("marker new")!, "5:1:1 Verse two")).toBeNull();
    // `module param <module> <param> <value>` is re-split by its handler (a param name
    // has spaces), so nothing in it is typed.
    expect((spec("module param")?.args ?? []).every((a) => !a.type)).toBe(true);
  });

  it("refuses a malformed scalar before the handler runs", () => {
    const specs = loadCommandSpecs();
    const of = (name: string) => specs.find((c) => c.command === name)!;
    expect(validateArgs(of("marker new"), "xyz Chorus")).toMatch(/bar:beat/);
    expect(validateArgs(of("track gain"), "melody abc")).toMatch(/a number/);
    expect(validateArgs(of("sequence note new"), "melody H9 4 6")).toMatch(
      /note name/,
    );
    // The offending token appears in the message, so the palette can point at it.
    expect(validateArgs(of("track pan"), "melody left")).toContain('"left"');
  });

  it("accepts every shape its handlers accept", () => {
    const specs = loadCommandSpecs();
    const of = (name: string) => specs.find((c) => c.command === name)!;
    for (const tc of ["5", "5:1", "5:1:1"])
      expect(validateArgs(of("marker new"), `${tc} Chorus`)).toBeNull();
    // Negative and fractional gains, notes as names or as MIDI numbers.
    expect(validateArgs(of("track gain"), "melody -6.5")).toBeNull();
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
