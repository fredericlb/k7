// Which components a turntables surface must have wired, and which a given mapping is missing.
// The desk's own vocabulary — @studio/song validates the SHAPE of a mapping and not its ids.

import {
  type MixView,
  MixViewSchema,
} from "@studio/song-schema/yaml/mixViewSchema";
// The BROWSER-SAFE half of @studio/song: `./surfaces` would drag `node:fs` into a screen package.
import { SURFACE_MAPPING_SKELETON } from "@studio/song-schema/yaml/surfaceSchema";
import { describe, expect, it } from "vitest";
import { mixControl } from "./controls";
import { DECKS } from "./deckVocabulary";
import { REQUIRED_CONTROLS, unmappedControls } from "./mapping";

const ids = (cs: readonly { id: string }[]) => cs.map((c) => c.id).sort();

/** Everything required, wired to anything — the shape is the schema's problem, not ours. */
const full = (): MixView =>
  Object.fromEntries(
    REQUIRED_CONTROLS.map((c) => [c.id, { module: "m", param: "p" }]),
  );

describe("REQUIRED_CONTROLS", () => {
  it("is the crossfade plus seven per deck", () => {
    expect(REQUIRED_CONTROLS).toHaveLength(1 + DECKS.length * 7);
    expect(ids(REQUIRED_CONTROLS)).toContain("crossfade");
    for (const d of DECKS)
      for (const s of [
        "tempo",
        "eqLow",
        "eqMid",
        "eqHigh",
        "filter",
        // The gain staging: without these two the crossfader is the only level control there is.
        "trim",
        "level",
      ])
        expect(ids(REQUIRED_CONTROLS)).toContain(`${d}.${s}`);
  });

  it("does NOT require the echo, which is optional wiring like the cue", () => {
    // A desk with no effect past the filter is a complete desk — ../docs/fx.md.
    for (const d of DECKS)
      expect(ids(REQUIRED_CONTROLS)).not.toContain(`${d}.echo`);
  });

  it("does NOT require the buttons that name no module param", () => {
    // `transport`, `sync` and `listen` are actions of the app: requiring one is an uncleanable error.
    const required = ids(REQUIRED_CONTROLS);
    expect(required).not.toContain("transport");
    expect(required).not.toContain("listen");
    for (const d of DECKS) expect(required).not.toContain(`${d}.sync`);
  });

  it("grows with the decks rather than being listed", () => {
    // A hardcoded pair would leave a third deck's knobs unrequired, which reads as "already fine".
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
    // Binding `transport` is allowed and simply not required, so wiring one raises nothing.
    const m = { ...full(), transport: { module: "m", param: "p" } };
    expect(unmappedControls(m)).toEqual([]);
  });

  it("does NOT check that the module exists", () => {
    // "Not wired" and "wired to something absent" are different fixes — `resolveBindings` says the second.
    const m = Object.fromEntries(
      REQUIRED_CONTROLS.map((c) => [c.id, { module: "nope", param: "nope" }]),
    );
    expect(unmappedControls(m)).toEqual([]);
  });
});

// The SCAFFOLD's copy of this vocabulary, held to the original — see ../docs/controls.md.
describe("the scaffold offers every control that must be wired", () => {
  const skeleton = SURFACE_MAPPING_SKELETON.turntables.map(([id]) => id);

  it("offers every control that must be wired", () => {
    // One missing from the skeleton is a component somebody has to find out about from the docs.
    for (const id of ids(REQUIRED_CONTROLS)) expect(skeleton).toContain(id);
  });

  it("offers nothing that is not a control of this desk", () => {
    // A SUPERSET, not an equality — but no id may be one the desk would reject (docs/stems.md).
    for (const id of skeleton) expect(mixControl(id), id).toBeTruthy();
    // …and the stems in particular ARE offered: the scaffold is where somebody finds the knobs.
    for (const d of DECKS)
      for (const s of ["stemDrums", "stemBass", "stemOther", "stemVocals"])
        expect(skeleton).toContain(`${d}.${s}`);
  });

  it("leaves out the controls that drive no param", () => {
    // Offering `transport`, `sync` or `listen` a module prints an error nobody can clear.
    for (const id of ["transport", "listen", `${DECKS[0]}.sync`])
      expect(skeleton).not.toContain(id);
  });

  it("says what each one wants, from the control's own `wants`", () => {
    // Read off MIX_CONTROLS, so a changed expectation takes the scaffold's note with it.
    for (const [id, note] of SURFACE_MAPPING_SKELETON.turntables) {
      const wants = mixControl(id)?.wants;
      expect(wants, id).toBeTruthy();
      expect(note, id).toContain(wants!);
    }
  });

  it("scaffolds a mapping the schema accepts", () => {
    // The nulls are the point: a key that is THERE is validated the moment it is filled in.
    const mapping = Object.fromEntries(skeleton.map((id) => [id, null]));
    expect(MixViewSchema.safeParse(mapping).success).toBe(true);
    // …and an unwired one is reported by the gate, exactly as an absent one is.
    expect(ids(unmappedControls(mapping))).toEqual(ids(REQUIRED_CONTROLS));
  });
});
