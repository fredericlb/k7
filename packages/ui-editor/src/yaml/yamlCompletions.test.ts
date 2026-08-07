import {
  autocompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { yamlCompletions } from "./completions";
import { cursorContext } from "./keyPath";

// The last unknown of the spike: can a syntax tree replace `analyze()` — the 88-line
// character scanner the CUE completions use to work out where the cursor is, and which
// entityLinks.ts and previewGutter.ts each re-implement?
//
// Tested headlessly: EditorState + syntaxTree need no DOM, so the real grammar and the
// real completion source run here exactly as they would in the browser.

/** A state with the cursor where `marker` ends. */
function at(doc: string, marker: string): { state: EditorState; pos: number } {
  const i = doc.indexOf(marker);
  if (i < 0) throw new Error(`marker not in doc: ${JSON.stringify(marker)}`);
  return {
    state: EditorState.create({ doc, extensions: [yaml(), autocompletion()] }),
    pos: i + marker.length,
  };
}

const MODULE = `plugin:
  type: internal
  name: Chorus
ui:
  cols: 4
  widgets:
    w1: { type: knob, col: 0, bind: Depth }
params:
  Mix: 1
`;

describe("the cursor's key path, from the tree", () => {
  const ctx = (doc: string, marker: string) => {
    const { state, pos } = at(doc, marker);
    return cursorContext(state, pos);
  };

  it("knows the top level", () => {
    expect(ctx(MODULE, "params:\n  Mix: 1\n")).toMatchObject({
      path: [],
      inKey: true,
    });
  });

  it("knows a nested block mapping", () => {
    // A fresh indented line inside `plugin:` — the case the tree alone gets wrong, and
    // the reason keyPosition() exists: the innermost pair is still plugin's.
    expect(ctx(MODULE, "plugin:\n  ")).toMatchObject({
      path: ["plugin"],
      inKey: true,
      valueOf: null,
    });
    expect(ctx(MODULE, "  cols: 4\n  ")).toMatchObject({
      path: ["ui"],
      inKey: true,
    });
  });

  it("knows a flow mapping three levels down", () => {
    expect(ctx(MODULE, "w1: { type: knob, ")).toMatchObject({
      path: ["ui", "widgets", "w1"],
      inKey: true,
    });
  });

  it("does not let a half-typed key complete against its own children", () => {
    // Typing `w1` is a key of the widgets mapping — not a position inside w1.
    expect(ctx(MODULE, "    w1")).toMatchObject({
      path: ["ui", "widgets"],
      inKey: true,
    });
  });

  it("tells a value position from a key one, and names the field", () => {
    expect(ctx(MODULE, "  type: inter")).toMatchObject({
      path: ["plugin"],
      inKey: false,
      valueOf: "type",
    });
    expect(ctx(MODULE, "w1: { type: kn")).toMatchObject({
      path: ["ui", "widgets", "w1"],
      inKey: false,
      valueOf: "type",
    });
  });

  it("names `extends` at the very top of a module file", () => {
    // The headline case, and the one that completed against nothing: the field sits at the
    // root, so the path is empty and there is no enclosing mapping to walk up to.
    expect(ctx('extends: "@engine/de', 'extends: "@engine/de')).toMatchObject({
      path: [],
      inKey: false,
      valueOf: "extends",
    });
  });

  it("reports a `- ` item as BOTH a key and a sequence item", () => {
    // Undecided by construction: `- song: x` is a mapping and `- x` is a scalar, and the
    // colon that tells them apart has not been typed. Saying "key" alone is what left a
    // playlist's `items:` with no completion at all.
    expect(ctx("items:\n  - AC", "  - AC")).toMatchObject({
      path: ["items"],
      inKey: true,
      inSeqItem: true,
    });
    // …and once the colon is there it is an ordinary entry again.
    expect(ctx("items:\n  - song: AC", "  - song: AC")).toMatchObject({
      path: ["items"],
      inKey: false,
      inSeqItem: false,
      valueOf: "song",
    });
  });

  it("survives a document being typed — an incomplete one", () => {
    // Completion runs on every keystroke, so the tree is usually of a broken document.
    // This is where a hand-rolled scanner earns its bugs.
    expect(ctx("ui:\n  widgets:\n    w1: { ty", "w1: { ty")).toMatchObject({
      path: ["ui", "widgets", "w1"],
      inKey: true,
    });
    expect(ctx("plugin:\n  ty", "  ty")).toMatchObject({
      path: ["plugin"],
      inKey: true,
    });
  });
});

describe("the completion source", () => {
  // A stand-in for the app's vocabulary (which is derived from the Zod schemas — see
  // @studio/song yaml/fields.ts). The editor knows none of these names; that is the
  // design, and the reason the tables can be deleted rather than ported.
  const vocab = {
    fieldsAt: (path: string[]) => {
      if (path.length === 0) return ["plugin", "ui", "params", "ir", "nam"];
      if (path[0] === "plugin") return ["type", "name"];
      if (path.join("/") === "ui") return ["cols", "rows", "widgets"];
      if (path[0] === "ui" && path[1] === "widgets" && path.length === 3)
        return ["type", "col", "row", "bind", "library"];
      return [];
    },
    valuesAt: (path: string[], field: string) => {
      if (path[0] === "plugin" && field === "type")
        return ["internal", "vst3", "clap"];
      if (path.length === 3 && field === "type") return ["knob", "slider"];
      return [];
    },
  };

  const complete = (doc: string, marker: string) => {
    const { state, pos } = at(doc, marker);
    const source: CompletionSource = yamlCompletions(vocab);
    return source({
      state,
      pos,
      explicit: true,
      matchBefore: (re: RegExp) => {
        const line = state.doc.lineAt(pos);
        const text = state.sliceDoc(line.from, pos);
        const m = text.match(re);
        return m ? { from: pos - m[0].length, to: pos, text: m[0] } : null;
      },
      aborted: null,
      tokenBefore: () => null,
      // biome-ignore lint/suspicious/noExplicitAny: a CompletionContext stub, not the real one
    } as any);
  };

  const labels = (r: unknown): string[] =>
    ((r as { options?: { label: string }[] } | null)?.options ?? []).map(
      (o) => o.label,
    );

  it("offers the top-level fields at the top level", () => {
    expect(labels(complete(MODULE, "params:\n  Mix: 1\n"))).toEqual([
      "plugin",
      "ui",
      "params",
      "ir",
      "nam",
    ]);
  });

  it("offers a nested struct's OWN fields, not the file's", () => {
    // The CUE bug this replaces: `structFields` returned [] for anything it had no branch
    // for, so `project: {}` offered nothing while the top level offered its fields.
    expect(labels(complete(MODULE, "plugin:\n  "))).toEqual(["type", "name"]);
    expect(labels(complete(MODULE, "  cols: 4\n  "))).toEqual([
      "cols",
      "rows",
      "widgets",
    ]);
  });

  it("offers a widget's fields inside its flow map", () => {
    expect(labels(complete(MODULE, "w1: { type: knob, "))).toContain("library");
  });

  it("offers VALUES once past the colon", () => {
    expect(labels(complete(MODULE, "  type: "))).toEqual([
      "internal",
      "vst3",
      "clap",
    ]);
    expect(labels(complete(MODULE, "w1: { type: "))).toEqual([
      "knob",
      "slider",
    ]);
  });

  it("offers nothing where the value is free text", () => {
    // `name:` takes any string. Offering the field list there is worse than offering
    // nothing — it reads as though those were the allowed values.
    expect(complete(MODULE, "  name: ")).toBeNull();
  });

  // A chain step names a module, and an inherited one is named by its ref. The token has
  // to run from the `@` through every `/`, or accepting the completion appends the full
  // ref to the half-typed one.
  it("completes a namespaced ref as ONE token", () => {
    const doc = `chains:
  melody:
    - track: melody
    - module: @engine/au
`;
    const refs = {
      fieldsAt: () => [],
      valuesAt: (_p: string[], f: string) =>
        f === "module" ? ["reverb", "@engine/audio/amp/nam"] : [],
    };
    const { state, pos } = at(doc, "module: @engine/au");
    const r = yamlCompletions(refs)({
      state,
      pos,
      explicit: true,
      matchBefore: (re: RegExp) => {
        const text = state.sliceDoc(state.doc.lineAt(pos).from, pos);
        const m = text.match(re);
        return m ? { from: pos - m[0].length, to: pos, text: m[0] } : null;
      },
      aborted: null,
      tokenBefore: () => null,
      // biome-ignore lint/suspicious/noExplicitAny: a CompletionContext stub, not the real one
    } as any);
    expect(labels(r)).toContain("@engine/audio/amp/nam");
    expect((r as { from: number }).from).toBe(pos - "@engine/au".length);
    // Unquoted, so accepting it must bring the quotes YAML needs round a `@` scalar.
    expect(
      (
        r as unknown as { options: { label: string; apply?: string }[] }
      ).options.find((o) => o.label === "@engine/audio/amp/nam")?.apply,
    ).toBe('"@engine/audio/amp/nam"');
    // …and the list must survive the next `/` the user types.
    expect((r as { validFor: RegExp }).validFor.test("@engine/audio/")).toBe(
      true,
    );
  });

  // A playlist's shape: the list holds bare song refs, and each item may instead be a
  // mapping naming a variant. Both vocabularies belong on a `- ` line.
  const PLAYLIST = {
    fieldsAt: (p: string[]) => (p[0] === "items" ? ["song", "variant"] : []),
    valuesAt: (p: string[], f: string) =>
      (p.length === 0 && f === "items") || (p[0] === "items" && f === "song")
        ? ["AC-DC/Back in Black/Hells Bells", "Nirvana/Nevermind/Lithium"]
        : [],
  };

  const completeWith = (
    vocabulary: typeof PLAYLIST,
    doc: string,
    marker: string,
  ) => {
    const { state, pos } = at(doc, marker);
    return yamlCompletions(vocabulary)({
      state,
      pos,
      explicit: true,
      matchBefore: (re: RegExp) => {
        const text = state.sliceDoc(state.doc.lineAt(pos).from, pos);
        const m = text.match(re);
        return m ? { from: pos - m[0].length, to: pos, text: m[0] } : null;
      },
      aborted: null,
      tokenBefore: () => null,
      // biome-ignore lint/suspicious/noExplicitAny: a CompletionContext stub, not the real one
    } as any);
  };

  it("offers a sequence's values AND the item's fields on a `- ` line", () => {
    const r = completeWith(PLAYLIST, "items:\n  - ", "  - ");
    expect(labels(r)).toEqual([
      "song",
      "variant",
      "AC-DC/Back in Black/Hells Bells",
      "Nirvana/Nevermind/Lithium",
    ]);
  });

  it("replaces the WHOLE value when one may hold spaces", () => {
    // A song folder is made from its tags, so it legitimately carries spaces. The word
    // token stops at the last one, and accepting the pick there would splice the ref into
    // the middle of itself: `- AC-DC/Back in AC-DC/Back in Black/Hells Bells`.
    const doc = "items:\n  - AC-DC/Back in Bl";
    const r = completeWith(PLAYLIST, doc, "  - AC-DC/Back in Bl") as {
      from: number;
    };
    expect(r.from).toBe(doc.indexOf("AC-DC/Back in Bl"));
    // …and the list must survive the space the user is about to type.
    expect(
      (r as unknown as { validFor: RegExp }).validFor.test("AC-DC/Back in "),
    ).toBe(true);
  });

  it("leaves a quote the user already opened alone", () => {
    const doc = "items:\n  - song: 'AC-DC/Back in Bl";
    const r = completeWith(PLAYLIST, doc, "'AC-DC/Back in Bl") as {
      from: number;
      options: { label: string; apply?: string }[];
    };
    expect(r.from).toBe(doc.indexOf("AC-DC/Back in Bl"));
    expect(r.options[0]?.apply).toBeUndefined();
  });

  it("quotes a value YAML would read as something else", () => {
    const reserved = {
      fieldsAt: () => [],
      valuesAt: () => ["-M-/Je dis aime/Machistador", "plain/one"],
    };
    const r = completeWith(
      reserved as unknown as typeof PLAYLIST,
      "items:\n  - ",
      "  - ",
    ) as unknown as { options: { label: string; apply?: string }[] };
    expect(r.options.find((o) => o.label.startsWith("-M-"))?.apply).toBe(
      '"-M-/Je dis aime/Machistador"',
    );
    // Only where it is needed: quoting everything would put YAML in a list of names.
    expect(r.options.find((o) => o.label === "plain/one")?.apply).toBe(
      "plain/one",
    );
  });

  it("completes from a half-typed word rather than replacing the line", () => {
    const r = complete(MODULE, "plugin:\n  ty") as { from: number } | null;
    const doc = MODULE;
    const pos = doc.indexOf("plugin:\n  ty") + "plugin:\n  ty".length;
    // `from` must sit at the start of the word, or accepting a completion would leave
    // the typed characters behind it.
    expect(r?.from).toBe(pos - 2);
  });
});
