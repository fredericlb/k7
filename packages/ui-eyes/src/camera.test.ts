// Which lens a label opens. The rule that matters is the one about NOT refusing: a project
// travels, and a camera that is not on this machine has to draw something and say why.
// See packages/song/docs/camera.md.

import { describe, expect, it } from "vitest";
import { type CameraDevice, cameraConstraint, matchCamera } from "./camera";

const cam = (deviceId: string, label: string): CameraDevice => ({
  deviceId,
  kind: "videoinput",
  label,
});

const HERE: CameraDevice[] = [
  cam("a1", "FaceTime HD Camera"),
  cam("b2", "Logitech BRIO (046d:085e)"),
  { deviceId: "m1", kind: "audioinput", label: "Built-in Microphone" },
];

describe("matching a label", () => {
  it("takes the exact name first", () => {
    expect(matchCamera("FaceTime HD Camera", HERE).deviceId).toBe("a1");
  });

  it("ignores case and stray spaces, which nobody types twice the same way", () => {
    expect(matchCamera("  facetime hd camera ", HERE).deviceId).toBe("a1");
  });

  it("finds a camera the browser dressed up with ids", () => {
    // The file says the name; the browser says the name plus a vendor pair.
    expect(matchCamera("Logitech BRIO", HERE).deviceId).toBe("b2");
  });

  it("…and the other way round, for a label copied WITH the ids", () => {
    expect(matchCamera("Logitech BRIO (046d:085e)", HERE).deviceId).toBe("b2");
  });

  it("never matches a MICROPHONE, whatever it is called", () => {
    expect(matchCamera("Built-in Microphone", HERE).problem).toContain(
      "no camera called",
    );
  });
});

describe("when it is not here", () => {
  it("falls back to the default and NAMES what the machine has", () => {
    const m = matchCamera("Blackmagic", HERE);
    expect(m.deviceId).toBeNull();
    expect(m.problem).toContain('no camera called "Blackmagic"');
    // Without this list the sentence cannot be acted on.
    expect(m.problem).toContain("FaceTime HD Camera");
    expect(m.problem).toContain("Logitech BRIO (046d:085e)");
  });

  it("says so plainly when the machine reports none at all", () => {
    expect(matchCamera("anything", []).problem).toContain("no camera at all");
  });

  it("treats an EMPTY label as the default, which is not a problem", () => {
    const m = matchCamera("", HERE);
    expect(m.deviceId).toBeNull();
    expect(m.problem).toBeUndefined();
  });
});

describe("the constraint it becomes", () => {
  it("names the device when one was found", () => {
    expect(cameraConstraint({ deviceId: "b2" })).toEqual({
      video: { deviceId: "b2" },
      audio: false,
    });
  });

  it("asks for ANY camera otherwise — never `exact`, which would fail instead of falling back", () => {
    expect(cameraConstraint({ deviceId: null })).toEqual({
      video: true,
      audio: false,
    });
  });

  it("never asks for sound: a picture lane has none, and asking would prompt for a microphone", () => {
    expect(cameraConstraint({ deviceId: "a1" }).audio).toBe(false);
  });
});
