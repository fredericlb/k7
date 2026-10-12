// useInstrumentStatus.test.ts — which instruments a document asks the engine about, and which nodes a missing
// one marks: every plugin naming it, and none whose instrument is a plain path or is there.

import type { WebProject, WebTrack } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import {
  instrumentName,
  instrumentNeeds,
  instrumentWarnings,
} from "./useInstrumentStatus";

const WURT = "@instruments/nbo-wurt/wurly.sfz";
const PIANO =
  "@instruments/salamander-grand-piano/Salamander Grand Piano V3.sfz";

function track(id: string, plugins: WebTrack["plugins"]): WebTrack {
  return { id, plugins } as WebTrack;
}

const doc = {
  tracks: [
    track("keys", [
      { id: "keys:wurt", type: "studio_sfz", name: "Wurlitzer", sfzFile: WURT },
      { id: "keys:verb", type: "studio_reverb", name: "Reverb" },
    ]),
    track("more", [
      { id: "more:wurt", type: "studio_sfz", name: "Wurlitzer", sfzFile: WURT },
      { id: "more:piano", type: "studio_sfz", name: "Piano", sfzFile: PIANO },
      {
        id: "more:own",
        type: "studio_sfz",
        name: "Own",
        sfzFile: "/samples/own.sfz",
      },
    ]),
  ],
} as WebProject;

describe("instrumentNeeds", () => {
  it("lists each @instruments ref once, with every plugin naming it", () => {
    const needs = instrumentNeeds(doc);
    expect([...needs.keys()].sort()).toEqual([PIANO, WURT].sort());
    expect(needs.get(WURT)).toEqual(["keys:wurt", "more:wurt"]);
  });

  it("asks nothing of a document with no instrument, or none at all", () => {
    expect(instrumentNeeds(null).size).toBe(0);
    expect(instrumentNeeds({ tracks: [] } as unknown as WebProject).size).toBe(
      0,
    );
  });
});

describe("instrumentWarnings", () => {
  it("marks only the plugins whose instrument is missing, by its tray name", () => {
    const w = instrumentWarnings(instrumentNeeds(doc), new Set([WURT]));
    expect(Object.keys(w).sort()).toEqual(["keys:wurt", "more:wurt"]);
    expect(w["keys:wurt"]).toContain("nbo-wurt");
  });

  it("names an instrument by its folder", () => {
    expect(instrumentName(PIANO)).toBe("salamander-grand-piano");
  });
});
