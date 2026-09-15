import {
  allSurfaceTypes,
  surfaceTypeOf,
} from "@studio/song-schema/yaml/surfaceRegistry";
import { describe, expect, it } from "vitest";
import "./plugins";
import {
  deviceSurfaceDrawer,
  registerSurfacePane,
  shellPaneDrawer,
} from "./surfacePanes";

// The registry replaces drawn()'s compile-time exhaustiveness: EVERY declared type is answered —
// the seed's core panes AND the plugins' drawers (the desk arrives from the turntables plugin) —
// and a drawer for a type no project can declare is refused here, not at mount.

describe("the pane registry", () => {
  it("answers every declared surface type with a device drawer", () => {
    for (const type of allSurfaceTypes())
      expect(deviceSurfaceDrawer(type), type).toBeTruthy();
  });

  it("gives the desk a ring slot, from the turntables plugin", () => {
    expect(shellPaneDrawer("turntables")).toBeTruthy();
    expect(shellPaneDrawer("timeline")).toBeUndefined();
  });

  it("refuses a second registration of a type, and a type nothing can declare", () => {
    expect(() =>
      registerSurfacePane({ type: "turntables", device: () => null }),
    ).toThrow(/already has a pane/);
    expect(() =>
      registerSurfacePane({ type: "waveform-ghost", device: () => null }),
    ).toThrow(/not registered/);
    expect(surfaceTypeOf("waveform-ghost")).toBeUndefined();
  });
});
