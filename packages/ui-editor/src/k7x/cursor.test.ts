// cursor.test.ts (k7x) — where the cursor sits in key terms, read from half-written text: the answers the yaml mode gives.

import { describe, expect, it } from "vitest";
import { k7xCursor } from "./cursor";

const at = (text: string) => k7xCursor(text);
const key = (path: string[]) => ({
  path,
  inKey: true,
  valueOf: null,
  inSeqItem: false,
  inString: false,
});
const value = (path: string[], of: string, inString = false) => ({
  path,
  inKey: false,
  valueOf: of,
  inSeqItem: false,
  inString,
});

describe("the k7x cursor", () => {
  it("is at a top-level key at the start, while typing one, and after a statement", () => {
    expect(at("")).toEqual(key([]));
    expect(at("ext")).toEqual(key([]));
    expect(at('extends("x")\npar')).toEqual(key([]));
    expect(at('extends("x")\n')).toEqual(key([]));
    expect(at("// a comment\n")).toEqual(key([]));
  });

  it("fills a call's value, inside its quotes or not", () => {
    expect(at("extends(")).toEqual(value([], "extends"));
    expect(at('extends("@wor')).toEqual(value([], "extends", true));
  });

  it("reads an object's keys and values under the call that holds it", () => {
    expect(at("project({ ")).toEqual(key(["project"]));
    expect(at('project({ name: "x", tem')).toEqual(key(["project"]));
    expect(at("project({ video: ")).toEqual(value(["project"], "video"));
    expect(at("engines({ tracktion: { pa")).toEqual(
      key(["engines", "tracktion"]),
    );
  });

  it("reads a list item as a value or a chain, and the chain's keys under the list's key", () => {
    expect(at("steps([\n  ")).toEqual({
      path: ["steps"],
      inKey: true,
      valueOf: null,
      inSeqItem: true,
      inString: false,
    });
    expect(at("steps([\n  ext")).toEqual(key(["steps"]));
    expect(at('steps([\n  extends("x")\n    .eng')).toEqual(key(["steps"]));
    expect(at('steps([\n  extends("x").engine(')).toEqual(
      value(["steps"], "engine"),
    );
    expect(at("steps([\n  id(1),\n  extends(")).toEqual(
      value(["steps"], "extends"),
    );
  });

  it("closes what was closed: a finished object, list or chain hands the cursor back", () => {
    expect(at('project({ name: "x", tempo: 120 })\nmar')).toEqual(key([]));
    expect(at('steps([id(1), to([chain("@out")])])\n')).toEqual(key([]));
    expect(at("params({ Level: -12, Gain: 1e5, ")).toEqual(key(["params"]));
  });

  it("reads a chain written as a call's value under that call's key", () => {
    expect(at("engines(tracktion(")).toEqual(value(["engines"], "tracktion"));
    expect(at("engines(tracktion(params({ Ra")).toEqual(
      key(["engines", "tracktion", "params"]),
    );
  });
});
