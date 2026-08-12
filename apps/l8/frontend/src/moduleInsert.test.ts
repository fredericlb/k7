// What the graph's `+` types into the command bar.
//
// This replaces a two-command dance — `module new`, then `chain add`, sent as two HTTP calls with a full project
// recompile wasted between them. The only reason for the split was that the frontend had to learn the new
// module's name before it could name it in a chain; `module insert` picks that name itself, so the tests that
// used to parse a command back into a name are gone with it.
//
// What matters now is the SHAPE of the line, because a person finishes typing it: the arrow has to come first
// so the node name lands last, and the line has to end in a space so the cursor sits where that name goes.

import { describe, expect, it } from "vitest";
import {
  moduleInsertCommand,
  modulePlaceCommand,
  type PendingInsert,
} from "./moduleInsert";

const arrow: PendingInsert = { before: "melody", after: "OUT" };

describe("the line the + pre-writes", () => {
  it("names the arrow first, so the node name is what the user is left typing", () => {
    const line = moduleInsertCommand(
      arrow,
      "audio",
      "adt",
      "@engine/audio/delay/adt",
    );
    expect(line).toBe(
      "module insert melody OUT audio/adt @engine/audio/delay/adt ",
    );
    // The trailing space is load-bearing: it is where the cursor lands.
    expect(line.endsWith(" ")).toBe(true);
    // Six tokens written; the node name the user types becomes the seventh and last, which is how a
    // person expects to finish a command.
    expect(line.trim().split(/\s+/)).toHaveLength(6);
  });

  it("omits the extends-ref for a module this project already has", () => {
    // The picker offers two kinds of thing. One is catalogue (inherit it); the other is already local, and
    // passing a ref for it would ask the command to CREATE something that exists.
    expect(moduleInsertCommand(arrow, "audio", "echo")).toBe(
      "module insert melody OUT audio/echo ",
    );
  });

  it("carries the arrow through verbatim — the seam is resolved server-side", () => {
    const l = moduleInsertCommand(
      { before: "neural-amp-modeler", after: "OUT" },
      "audio",
      "wah",
    );
    expect(l).toContain("neural-amp-modeler OUT");
  });
});

describe("the line a right-click on empty canvas pre-writes", () => {
  it("is the same gesture without a target", () => {
    // Same tail, same trailing space, same last-thing-you-type. Only the verb and the two
    // node names differ, so the pair reads as one action with and without an arrow.
    const line = modulePlaceCommand("audio", "adt", "@engine/audio/delay/adt");
    expect(line).toBe("module place audio/adt @engine/audio/delay/adt ");
    expect(line.endsWith(" ")).toBe(true);
  });

  it("omits the extends-ref for a module this project already has", () => {
    // Which leaves ONE optional for the user to type — and the command reads it by shape,
    // so a name with no slash is a node rather than a ref that doesn't exist.
    expect(modulePlaceCommand("audio", "echo")).toBe(
      "module place audio/echo ",
    );
  });
});
