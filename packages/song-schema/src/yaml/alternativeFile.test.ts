// The attribute-set writers: a knob turned on a set lands in THAT set, never under it.

import { K7Document, type K7Scope } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  addAlternative,
  alternativeNames,
  clearAlternativeParams,
  paramsSwitch,
  setAlternative,
  setAlternativeField,
  setAlternativeParam,
} from "./alternativeFile";
import { AlternativeSchema } from "./moduleSchema";

/** A module's data as these tests read it back. */
interface Mod {
  [key: string]: unknown;
  alternatives: Record<string, unknown>[];
  engines: Record<string, { params: unknown }>;
}

/** Run one writer over a whole file, handing back its text and what the writer answered. */
function edit<T>(text: string, fn: (doc: K7Scope) => T) {
  const doc = new K7Document(text);
  const out = fn(doc.at([]));
  return { text: doc.toString(), data: doc.toJS() as unknown as Mod, out };
}

const SETS = `params({ Gain: 3 })
alternatives([
  name("crunch").params({ Gain: 9 }),
])
alternative("crunch")
`;

describe("setAlternativeParam", () => {
  it("writes the module's own params while the first set is on", () => {
    const { data } = edit("params({ Gain: 3 })\n", (d) =>
      setAlternativeParam(d, "Gain", 5),
    );
    expect(data.params).toEqual({ Gain: 5 });
  });

  it("writes into the set that is on, leaving the module's own alone", () => {
    const { data } = edit(SETS, (d) => setAlternativeParam(d, "Tone", 2));
    expect(data.params).toEqual({ Gain: 3 });
    expect(data.alternatives[0].params).toEqual({ Gain: 9, Tone: 2 });
  });

  it("fills an empty set", () => {
    // The shape `node alternative create` writes, and the case where every knob used to land on set 1.
    const { data } = edit(
      'params({ Gain: 3 })\nalternatives([{}])\nalternative("2")\n',
      (d) => setAlternativeParam(d, "Gain", 7),
    );
    expect(data.alternatives[0].params).toEqual({ Gain: 7 });
    expect(data.params).toEqual({ Gain: 3 });
  });

  it("removes a param on null, under the engine named, and leaves a file without it untouched", () => {
    const text =
      'engine("nam")\nengines({ nam: { params: { model: "a.nam", ir: "b.wav" } } })\n';
    const { data } = edit(text, (d) =>
      setAlternativeParam(d, "model", null, "nam"),
    );
    expect(data.engines.nam.params).toEqual({ ir: "b.wav" });
    const bare = "params({ Gain: 3 })\n";
    expect(edit(bare, (d) => setAlternativeParam(d, "model", null)).text).toBe(
      bare,
    );
  });

  it("edits a chain item through its scope, the rest of the file untouched", () => {
    const chain = 'items([\n  id("a").params({ Gain: 1 }),\n  id("b"),\n])\n';
    const doc = new K7Document(chain);
    setAlternativeParam(doc.at(["items", 1]), "Gain", 4);
    expect(doc.toJS()).toEqual({
      items: [
        { id: "a", params: { Gain: 1 } },
        { id: "b", params: { Gain: 4 } },
      ],
    });
  });
});

describe("clearAlternativeParams", () => {
  it("drops the numbers, keeps a file param, and the map once it empties", () => {
    const { data } = edit('params({ Gain: 3, model: "a.nam" })\n', (d) =>
      clearAlternativeParams(d),
    );
    expect(data.params).toEqual({ model: "a.nam" });
    const gone = edit("params({ Gain: 3 })\n", (d) =>
      clearAlternativeParams(d),
    );
    expect(gone.data.params).toBeUndefined();
  });
});

describe("switching sets", () => {
  it("names them, writes the switch, and clears it back on the first", () => {
    expect(alternativeNames(edit(SETS, () => 0).data)).toEqual(["1", "crunch"]);
    const off = edit(SETS, (d) => setAlternative(d, "1"));
    expect(off.data.alternative).toBeUndefined();
    expect(edit(off.text, (d) => setAlternative(d, "crunch")).text).toBe(SETS);
    expect(() => edit(SETS, (d) => setAlternative(d, "ghost"))).toThrow(
      /no alternative/,
    );
  });

  it("reads a numbers-only switch as values", () => {
    const sw = paramsSwitch(edit(SETS, () => 0).data, "1");
    expect(sw).toEqual({ params: { Gain: 3 }, inherited: [] });
  });

  it("sets a field on the set that is on", () => {
    const { data } = edit(SETS, (d) => setAlternativeField(d, "engine", "nam"));
    expect(data.alternatives[0].engine).toBe("nam");
    expect(data.engine).toBeUndefined();
  });
});

describe("addAlternative", () => {
  it("copies a chain step's settings, never its own id or bypass", () => {
    const step =
      'id("8339210a")\nextends("@k7-core/fx/drive")\nbypass(true)\nparams({ Gain: 3 })\n';
    const { data, out } = edit(step, (d) =>
      addAlternative(d, undefined, { copy: true }),
    );
    expect(out).toBe("2");
    expect(data.alternatives).toEqual([{ params: { Gain: 3 } }]);
    expect(data.alternative).toBe("2");
    expect(data.id).toBe("8339210a");
    expect(AlternativeSchema.safeParse(data.alternatives[0]).success).toBe(
      true,
    );
  });

  it("appends to the list, a lane's empty set holding no events", () => {
    const { data, out } = edit(SETS, (d) =>
      addAlternative(d, "clean", { blankEvents: true }),
    );
    expect(out).toBe("clean");
    expect(data.alternatives[1]).toEqual({ name: "clean", events: [] });
    expect(() => edit(SETS, (d) => addAlternative(d, "crunch"))).toThrow(
      /already has/,
    );
  });
});
