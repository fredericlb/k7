// Which components a turntables surface must have wired, and which a given mapping is missing.
// The desk's own vocabulary — @studio/song validates the SHAPE of a mapping and not its ids.

import { type MixView, MixViewSchema } from "@studio/song/yaml/mixViewSchema";
// The BROWSER-SAFE half of @studio/song. `./surfaces` would be the disk walk, and importing it
// here drags `node:fs` into a package that draws a screen and has no node types — which is the
// same boundary this describe block is about.
import { SURFACE_MAPPING_SKELETON } from "@studio/song/yaml/surfaceSchema";
import { describe, expect, it } from "vitest";
import { mixControl } from "./controls";
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

/**
 * The SCAFFOLD's copy of this vocabulary, held to the original.
 *
 * `project surface new turntables` writes a mapping skeleton — every component, a `null`, and a
 * note on what it wants — and that list lives in `@studio/song`'s browser-safe half, because a
 * CLI scaffold cannot import this package: `controls.ts` reaches `deck.ts` reaches
 * `@studio/engine-browser`. Nor the other way: this package has no node types.
 *
 * docs/surfaces.md says @studio/song does not know what a crossfade is, and that is still the
 * rule. What the rule protects against is the copy going stale, so this is where it is enforced:
 * this file can see both, and it fails when the desk grows a control the scaffold does not offer.
 */
describe("the scaffold offers every control that must be wired", () => {
  const skeleton = SURFACE_MAPPING_SKELETON.turntables.map(([id]) => id);

  it("offers every control that must be wired", () => {
    // A required control missing from the skeleton is a component somebody has to find out
    // about from the docs.
    for (const id of ids(REQUIRED_CONTROLS)) expect(skeleton).toContain(id);
  });

  it("offers nothing that is not a control of this desk", () => {
    // The other direction, and it is no longer equality: the skeleton is a SUPERSET now. The
    // stem cuts are offered and not required — a desk with none is a complete desk, so a set
    // that does not wire them must not be told it is missing something — which is exactly the
    // difference between "what you may wire" and "what has to be wired before this draws".
    //
    // What still cannot happen is a line the desk would call "n'est pas un contrôle du
    // pupitre", so every id is held to being a real control.
    for (const id of skeleton) expect(mixControl(id), id).toBeTruthy();
    // …and the stems in particular ARE offered: the scaffold is where somebody finds out the
    // knobs exist at all.
    for (const d of DECKS)
      for (const s of ["stemDrums", "stemBass", "stemOther", "stemVocals"])
        expect(skeleton).toContain(`${d}.${s}`);
  });

  it("leaves out the controls that drive no param", () => {
    // `transport`, `sync` and `listen` are actions of the application. Offering them a module
    // would print an error nobody can clear — the same line REQUIRED_CONTROLS draws.
    for (const id of ["transport", "listen", `${DECKS[0]}.sync`])
      expect(skeleton).not.toContain(id);
  });

  it("says what each one wants, from the control's own `wants`", () => {
    // The note beside each null. Read off MIX_CONTROLS here so a control whose expectation
    // changes takes the scaffold's note with it rather than leaving it saying the old thing.
    for (const [id, note] of SURFACE_MAPPING_SKELETON.turntables) {
      const wants = mixControl(id)?.wants;
      expect(wants, id).toBeTruthy();
      expect(note, id).toContain(wants!);
    }
  });

  it("scaffolds a mapping the schema accepts", () => {
    // The null values are the point: a key that is THERE is validated the moment it is filled in,
    // where a commented line is not something a parser can ever tell you that you got wrong.
    const mapping = Object.fromEntries(skeleton.map((id) => [id, null]));
    expect(MixViewSchema.safeParse(mapping).success).toBe(true);
    // …and an unwired one is reported by the gate, exactly as an absent one is. The stems are
    // in the mapping and NOT in this list, which is the superset rule seen from the gate: an
    // offered line nobody filled in is not a missing one.
    expect(ids(unmappedControls(mapping))).toEqual(ids(REQUIRED_CONTROLS));
  });
});
