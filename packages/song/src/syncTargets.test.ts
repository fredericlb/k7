import { describe, expect, it } from "vitest";
import { normalizePreferences } from "./preferences.ts";

/** The normaliser is the GATE: a target it drops is one no surface can offer a button for. */
const targets = (v: unknown) =>
  normalizePreferences({ syncTargets: v }).syncTargets;

describe("the sync targets a machine declares", () => {
  it("keeps a file:// and an ftp:// one, in the order written", () => {
    expect(
      targets([
        { name: "Clé USB", uri: "file:///media/usb/MUSIC" },
        { name: "Régie", uri: "ftp://dj@box.lan/music" },
      ]),
    ).toEqual([
      { name: "Clé USB", uri: "file:///media/usb/MUSIC" },
      { name: "Régie", uri: "ftp://dj@box.lan/music" },
    ]);
  });

  it("drops a URI nothing can copy to, so no dead button is ever offered", () => {
    expect(
      targets([
        { name: "SFTP", uri: "sftp://box.lan/music" },
        { name: "Web", uri: "http://box.lan/music" },
        { name: "Vide", uri: "" },
        { name: "", uri: "file:///media/usb" },
        { name: "Bonne", uri: "file:///media/usb" },
      ]),
    ).toEqual([{ name: "Bonne", uri: "file:///media/usb" }]);
  });

  it("keeps the FIRST of two targets sharing a name, that being the identity a caller sends", () => {
    expect(
      targets([
        { name: "Clé", uri: "file:///media/one" },
        { name: "Clé", uri: "file:///media/two" },
      ]),
    ).toEqual([{ name: "Clé", uri: "file:///media/one" }]);
  });

  it("is absent rather than empty when nothing survives", () => {
    // Absent means "this machine syncs nowhere"; an empty list would be a second way to say it.
    expect(targets([{ name: "x", uri: "sftp://nope" }])).toBeUndefined();
    expect(targets([])).toBeUndefined();
    expect(targets("not a list")).toBeUndefined();
  });

  it("trims, since these are typed by hand into a YAML file", () => {
    expect(
      targets([{ name: "  Clé  ", uri: "  file:///media/usb  " }]),
    ).toEqual([{ name: "Clé", uri: "file:///media/usb" }]);
  });
});
