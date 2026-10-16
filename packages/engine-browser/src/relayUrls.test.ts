import { describe, expect, it } from "vitest";
import { relayUrls } from "./probe.ts";

describe("relayUrls", () => {
  it("reaches a relay on ANOTHER origin at that origin, not the page's", () => {
    const r = relayUrls(
      "https://play.priv.st0.app",
      "05ff",
      "t.k",
      "https://priv.st0.app/@local/ws/p.k7",
    );
    expect(r.ws).toBe("wss://play.priv.st0.app/api/engine/05ff/ws?ticket=t.k");
    expect(r.rtc).toBe("rtc:https://play.priv.st0.app/api/engine/05ff/rtc");
  });

  it("reaches a relay given as a PATH on the page's own origin", () => {
    const r = relayUrls(
      "/pl8",
      "e1",
      "x",
      "https://studio.frediver.se/songs/a.k7",
    );
    expect(r.ws).toBe("wss://studio.frediver.se/pl8/api/engine/e1/ws?ticket=x");
    expect(r.rtc).toBe("rtc:https://studio.frediver.se/pl8/api/engine/e1/rtc");
  });

  it("dials a plain-HTTP relay over ws:", () => {
    const r = relayUrls(
      "http://localhost:8789",
      "e1",
      "x",
      "http://localhost:5223/",
    );
    expect(r.ws).toBe("ws://localhost:8789/api/engine/e1/ws?ticket=x");
  });
});
