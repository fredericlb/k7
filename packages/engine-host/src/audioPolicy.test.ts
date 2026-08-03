import { describe, expect, it } from "vitest";
import {
  type AudioDevice,
  desiredSwitch,
  menuSignature,
  signature,
} from "./audioPolicy.ts";

// Ported 1:1 from apps/capot/src-tauri/src/audio.rs, test names kept — they state the
// rules more plainly than the code does, and they are the reason the policy is a pure
// module rather than something inlined in the poll loop.

const dev = (name: string, current: boolean): AudioDevice => ({
  name,
  deviceType: "CoreAudio",
  current,
});

describe("desiredSwitch", () => {
  it("stays put when already on the preferred device", () => {
    const d = [dev("Scarlett", true), dev("Built-in", false)];
    expect(desiredSwitch(d, "Scarlett", "Built-in")).toBeNull();
  });

  it("returns to the preferred device when it reappears", () => {
    // The interface was replugged; the engine is still on the fallback.
    const d = [dev("Scarlett", false), dev("Built-in", true)];
    expect(desiredSwitch(d, "Scarlett", "Built-in")).toBe("Scarlett");
  });

  it("falls back when the preferred device is unplugged", () => {
    const d = [dev("Built-in", false), dev("HDMI", true)];
    expect(desiredSwitch(d, "Scarlett", "Built-in")).toBe("Built-in");
  });

  it("fallback never overrides a deliberate choice", () => {
    // Preferred is present and current; the fallback must stay out of the way.
    const d = [dev("Scarlett", true), dev("Built-in", false)];
    expect(desiredSwitch(d, "Scarlett", "Built-in")).toBeNull();
    // …and with no preference at all, a device is already current — leave it.
    expect(desiredSwitch(d, null, "Built-in")).toBeNull();
  });

  it("fallback applies when nothing is current and nothing was picked", () => {
    const d = [dev("Built-in", false), dev("HDMI", false)];
    expect(desiredSwitch(d, null, "Built-in")).toBe("Built-in");
  });

  it("does nothing when neither the pick nor the fallback is present", () => {
    const d = [dev("HDMI", true)];
    expect(desiredSwitch(d, "Scarlett", "Built-in")).toBeNull();
  });

  it("empty device list is never acted on", () => {
    expect(desiredSwitch([], "Scarlett", "Built-in")).toBeNull();
  });
});

describe("signature / menuSignature", () => {
  it("signature ignores ordering but not membership", () => {
    const a = [dev("A", false), dev("B", true)];
    const b = [dev("B", false), dev("A", false)];
    expect(signature(a)).toBe(signature(b));
    expect(signature(a)).not.toBe(signature([dev("A", false)]));
  });

  it("menuSignature tracks what the submenu draws, not just membership", () => {
    // `current` moves the ✓, and both settings are rendered — so all three have to
    // move the signature, or the rebuilt-only-on-change guard would show stale rows.
    const base = [dev("A", false), dev("B", true)];
    const sig = menuSignature(base, "A", "B");
    expect(menuSignature([dev("A", true), dev("B", false)], "A", "B")).not.toBe(
      sig,
    );
    expect(menuSignature(base, "B", "B")).not.toBe(sig);
    expect(menuSignature(base, "A", null)).not.toBe(sig);
    // …and, like signature, it is order-insensitive.
    expect(menuSignature([dev("B", true), dev("A", false)], "A", "B")).toBe(
      sig,
    );
  });
});
