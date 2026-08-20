import { describe, expect, it } from "vitest";
import {
  completionOrder,
  ENGINE_NS,
  engineRef,
  isEngineRef,
  type ModuleStatus,
  moduleStatusOf,
} from "./moduleTypes";

// Which refs belong to the ENGINE — the plugin scan, the one namespace with no folder anywhere.
// It decides what the module-name completions leave out (see commandSpec's `modules` provider
// and hints.ts's `sharedRefs`), so a ref wrongly called the engine's disappears from the palette.

describe("isEngineRef", () => {
  it("claims the namespace and everything under it", () => {
    expect(isEngineRef(ENGINE_NS)).toBe(true);
    expect(isEngineRef(engineRef("neural-amp-modeler"))).toBe(true);
    expect(isEngineRef("@engine/audio/delay/adt")).toBe(true);
  });

  it("does NOT claim a namespace that merely starts with the same letters", () => {
    // The reason this is a function and not a `startsWith("@engine")` at each call site: a
    // library called `@engineering` is somebody's shared folder, and swallowing it here would
    // take every module in it out of the completions with no way to tell why.
    expect(isEngineRef("@engineering/audio/eq")).toBe(false);
    expect(isEngineRef("@engines/x")).toBe(false);
  });

  it("leaves the other namespaces alone — those are folders, and they complete", () => {
    expect(isEngineRef("@st0/audio/amp/nam")).toBe(false);
    expect(isEngineRef("@workspace/io/desk")).toBe(false);
    expect(isEngineRef("@project/instruments/bass")).toBe(false);
  });

  it("says nothing about a bare local name, which carries no namespace at all", () => {
    expect(isEngineRef("instruments/bass")).toBe(false);
    expect(isEngineRef("")).toBe(false);
  });
});

// `status:` — the one module field that changes no sound, only how the completions treat it.
// The ordering is what a person notices, so it is pinned rather than left to a comment.

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

  // Losing a module from the palette with nothing on screen to say why is the one failure this
  // field must not have — so anything unrecognisable is listed, not hidden.
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

  // The contract callers depend on: they hand this an alphabetical list and expect it back
  // alphabetical, in two blocks. A sort here would be a second ordering rule competing with theirs.
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
