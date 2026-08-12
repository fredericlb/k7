// Which components a turntables surface must have wired, and which a given mapping is missing.
// The desk's own vocabulary — @studio/song validates the SHAPE of a mapping and not its ids.

import type { MixView } from "@studio/song/yaml/mixViewSchema";
import { describe, expect, it } from "vitest";
import { DECKS } from "./deck";
import { REQUIRED_CONTROLS, unmappedControls } from "./mapping";

const ids = (cs: readonly { id: string }[]) => cs.map((c) => c.id).sort();

/** Everything required, wired to anything — the shape is the schema's problem, not ours. */
const full = (): MixView =>
  Object.fromEntries(
    REQUIRED_CONTROLS.map((c) => [c.id, { module: "m", param: "p" }]),
  );

describe("REQUIRED_CONTROLS", () => {
  it("is the crossfade plus five per deck", () => {
    expect(REQUIRED_CONTROLS).toHaveLength(1 + DECKS.length * 5);
    expect(ids(REQUIRED_CONTROLS)).toContain("crossfade");
    for (const d of DECKS)
      for (const s of ["tempo", "eqLow", "eqMid", "eqHigh", "filter"])
        expect(ids(REQUIRED_CONTROLS)).toContain(`${d}.${s}`);
  });

  it("does NOT require the buttons that name no module param", () => {
    // `transport`, `sync` and `listen` are actions of the application — play the set, align two
    // beats, monitor in this tab. Requiring a mapping for them would print an error that cannot
    // be cleared, because there is no param for the line to point at.
    const required = ids(REQUIRED_CONTROLS);
    expect(required).not.toContain("transport");
    expect(required).not.toContain("listen");
    for (const d of DECKS) expect(required).not.toContain(`${d}.sync`);
  });

  it("grows with the decks rather than being listed", () => {
    // A third deck is a third track and a second meeting point in the chains file. A hardcoded
    // pair here would leave the new deck's knobs silently unrequired, which reads as "already
    // fine" rather than "not wired yet".
    for (const d of DECKS)
      expect(REQUIRED_CONTROLS.some((c) => c.id.startsWith(`${d}.`))).toBe(
        true,
      );
  });
});

describe("unmappedControls", () => {
  it("is everything when there is no mapping at all", () => {
    expect(ids(unmappedControls(undefined))).toEqual(ids(REQUIRED_CONTROLS));
    expect(ids(unmappedControls({}))).toEqual(ids(REQUIRED_CONTROLS));
  });

  it("is empty once every required control names a module", () => {
    expect(unmappedControls(full())).toEqual([]);
  });

  it("names exactly what is missing", () => {
    const { crossfade: _dropped, ...rest } = full();
    expect(ids(unmappedControls(rest))).toEqual(["crossfade"]);
  });

  it("ignores extra lines for controls it does not require", () => {
    // Binding `transport` is allowed — it is simply not required. A surface that wired one must
    // not be told it is missing something.
    const m = { ...full(), transport: { module: "m", param: "p" } };
    expect(unmappedControls(m)).toEqual([]);
  });

  it("does NOT check that the module exists", () => {
    // A different failure, caught later against the compiled graph by `resolveBindings`, which
    // can say WHICH name was not found. "You have not wired this" and "you wired this to
    // something that is not there" are different sentences and different fixes.
    const m = Object.fromEntries(
      REQUIRED_CONTROLS.map((c) => [c.id, { module: "nope", param: "nope" }]),
    );
    expect(unmappedControls(m)).toEqual([]);
  });
});
