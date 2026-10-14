import { describe, expect, it } from "vitest";
import {
  completionOrder,
  ENGINE_NS,
  engineRef,
  isEngineRef,
  type ModuleStatus,
  moduleStatusOf,
} from "./moduleTypes";

// Which refs belong to the ENGINE, since one wrongly called so disappears from the palette (docs/moduleTypes.md).

describe("isEngineRef", () => {
  it("claims the namespace and everything under it", () => {
    expect(isEngineRef(ENGINE_NS)).toBe(true);
    expect(isEngineRef(engineRef("neural-amp-modeler"))).toBe(true);
    expect(isEngineRef("@engine/audio/delay/adt")).toBe(true);
  });

  it("does NOT claim a namespace that merely starts with the same letters", () => {
    // Why this is a function and not a `startsWith("@engine")`: `@engineering` is somebody's folder.
    expect(isEngineRef("@engineering/audio/eq")).toBe(false);
    expect(isEngineRef("@engines/x")).toBe(false);
  });

  it("leaves the other namespaces alone — those are folders, and they complete", () => {
    expect(isEngineRef("@k7-core/audio/amp/nam")).toBe(false);
    expect(isEngineRef("@workspace/io/desk")).toBe(false);
    expect(isEngineRef("@project/instruments/bass")).toBe(false);
  });

  it("says nothing about a bare local name, which carries no namespace at all", () => {
    expect(isEngineRef("instruments/bass")).toBe(false);
    expect(isEngineRef("")).toBe(false);
  });
});

// `status:` changes no sound, only how the completions treat a module — the ordering is what shows.

describe("moduleStatusOf", () => {
  it("defaults to listed, for everything that does not say", () => {
    expect(moduleStatusOf({})).toBe("listed");
    expect(moduleStatusOf({ status: "listed" })).toBe("listed");
    expect(moduleStatusOf(undefined)).toBe("listed");
    expect(moduleStatusOf(null)).toBe("listed");
  });

  it("reads the two that do", () => {
    expect(moduleStatusOf({ status: "hidden" })).toBe("hidden");
    expect(moduleStatusOf({ status: "favorite" })).toBe("favorite");
  });

  // Losing a module from the palette with nothing to say why is the one failure this must not have.
  it("is forgiving: a word it does not know is listed", () => {
    expect(moduleStatusOf({ status: "FAVORITE" })).toBe("listed");
    expect(moduleStatusOf({ status: 3 })).toBe("listed");
    expect(moduleStatusOf("not a module")).toBe("listed");
  });
});

describe("completionOrder", () => {
  const status = (m: string): ModuleStatus =>
    m.startsWith("fav")
      ? "favorite"
      : m.startsWith("hid")
        ? "hidden"
        : "listed";

  it("floats the favourites and drops the hidden", () => {
    expect(
      completionOrder(["amp", "fav-bass", "hid-test", "verb"], status),
    ).toEqual(["fav-bass", "amp", "verb"]);
  });

  // The contract: an alphabetical list comes back alphabetical, in two blocks (docs/moduleTypes.md).
  it("is STABLE within each group — the caller's order survives", () => {
    expect(
      completionOrder(["fav-a", "b", "fav-c", "d", "fav-e"], status),
    ).toEqual(["fav-a", "fav-c", "fav-e", "b", "d"]);
  });

  it("leaves a list with nothing to say about status exactly as it was", () => {
    const plain = ["a", "b", "c"];
    expect(completionOrder(plain, () => "listed")).toEqual(plain);
  });

  it("can empty a list, and that is a legal answer", () => {
    expect(completionOrder(["hid-1", "hid-2"], status)).toEqual([]);
  });
});
