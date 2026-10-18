import { describe, expect, it } from "vitest";
import { missingKey, missingOf } from "./engineMissing";

describe("missingOf", () => {
  it("reads a file the engine refused, by its name alone", () => {
    expect(
      missingOf(
        "rack sample 'C:\\Users\\me\\libraries\\k7-core\\1\\samples\\Leviathan4\\Kick_C#_03.wav' is outside the folders this engine reads — ignored",
      ),
    ).toEqual({ what: "rack sample", name: "Kick_C#_03.wav", why: "refused" });
    expect(
      missingOf(
        "surge patch '/srv/libs/surge-xt/base/Basses/E-Bass.fxp' is outside the folders this engine reads — ignored",
      ),
    ).toEqual({ what: "surge patch", name: "E-Bass.fxp", why: "refused" });
  });

  it("reads a file that is not there", () => {
    expect(missingOf("clip source not found/invalid: /a/b/take.wav")).toEqual({
      what: "clip",
      name: "take.wav",
      why: "not-found",
    });
    expect(
      missingOf(
        "rack sound 'KICK' -> '/a/BD.wav' is missing or unreadable; skipped",
      ),
    ).toEqual({ what: "rack sample", name: "BD.wav", why: "not-found" });
  });

  it("reads a plugin the machine does not have", () => {
    expect(
      missingOf(
        "plugin 'abc' (Surge XT) is not in the cache — run 'k7 engine scan'",
      ),
    ).toEqual({ what: "plugin", name: "Surge XT", why: "not-installed" });
    expect(missingOf("could not create plugin 'Diva' (vst3)")).toEqual({
      what: "plugin",
      name: "Diva",
      why: "not-installed",
    });
  });

  it("ignores every other warning, preset saves included", () => {
    expect(
      missingOf(
        "preset save path '/a/x.vstpreset' is not a .vstpreset under the folders this engine writes — not saved",
      ),
    ).toBeNull();
    expect(missingOf("audio device not found: Focusrite")).toBeNull();
  });

  it("keys the same file named twice as one", () => {
    const a = missingOf("clip source not found/invalid: /a/take.wav");
    const b = missingOf("clip source not found/invalid: /b/take.wav");
    expect(a && b && missingKey(a) === missingKey(b)).toBe(true);
  });
});
