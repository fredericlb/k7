// The scan gate: a load naming an external plugin waits for the engine's scan, and nothing waits for ever.
// What would be wrong SILENTLY: a scan that never ends, holding the project until someone reloads.

import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const home = mkdtempSync(join(tmpdir(), "scan-gate-home-"));
process.env.STUDIO_HOME = home;

vi.mock("@studio/song/externalPlugins", () => ({
  namesExternalPlugin: (dir: string) => dir.includes("external"),
}));

const { beginLoad, endLoad, loadPhase } = await import("./engineLoad.ts");
const { engineScanOf, scanHolds, SCAN_ASK_MS, SCAN_STALL_MS } = await import(
  "./engineScanGate.ts"
);

class FakeLink extends EventEmitter {
  pluginScan: {
    scanning: boolean;
    done: number;
    total: number;
    current: string;
    version: number;
  } | null = null;
  asked = 0;
  listed = 0;
  askPluginScan() {
    this.asked++;
  }
  listPlugins() {
    this.listed++;
  }
  scan(scanning: boolean, done = 0, total = 0, version = 0) {
    this.pluginScan = { scanning, done, total, current: "", version };
    this.emit("pluginScan", this.pluginScan);
  }
}

let n = 0;
let session: string;
beforeEach(() => {
  vi.useFakeTimers();
  session = `s${++n}`;
  beginLoad(session);
});
afterEach(() => {
  endLoad(session);
  vi.useRealTimers();
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("scanHolds", () => {
  it("never holds a project of built-ins", () => {
    const link = new FakeLink();
    link.scan(true, 1, 10);
    expect(
      scanHolds(
        session,
        "/w/builtin.k7",
        () => "r",
        link,
        () => {},
      ),
    ).toBe(false);
    expect(loadPhase(session)).toBe("copying");
  });

  it("does not hold once the engine has said its scan is over", () => {
    const link = new FakeLink();
    link.scan(false, 10, 10, 1);
    expect(
      scanHolds(
        session,
        "/w/external.k7",
        () => "r",
        link,
        () => {},
      ),
    ).toBe(false);
  });

  it("holds while the scan runs, reports it, and resends once the catalogue is written", () => {
    const link = new FakeLink();
    link.scan(true, 2, 8);
    const resend = vi.fn();
    expect(scanHolds(session, "/w/external.k7", () => "r", link, resend)).toBe(
      true,
    );
    expect(loadPhase(session)).toBe("scanning");
    // Asked again while it waits, it still holds and starts nothing new.
    expect(scanHolds(session, "/w/external.k7", () => "r", link, resend)).toBe(
      true,
    );
    link.scan(true, 5, 8);
    expect(engineScanOf(session)).toEqual({ done: 5, total: 8, current: "" });
    link.emit("plugins", [{ name: "Serum", format: "VST3" }]);
    link.scan(false, 8, 8, 1);
    return vi.waitFor(() => {
      expect(resend).toHaveBeenCalledTimes(1);
      expect(loadPhase(session)).toBe("copying");
      expect(readFileSync(join(home, "exts.json"), "utf8")).toContain("Serum");
    });
  });

  it("asks an engine that has said nothing, and lets go of one that never answers", () => {
    const link = new FakeLink();
    const resend = vi.fn();
    expect(scanHolds(session, "/w/external.k7", () => "r", link, resend)).toBe(
      true,
    );
    expect(link.asked).toBe(1);
    vi.advanceTimersByTime(SCAN_ASK_MS + 1);
    return vi.waitFor(() => {
      expect(resend).toHaveBeenCalledTimes(1);
      // …and is not asked again on this link: it is older than the question.
      expect(
        scanHolds(session, "/w/external.k7", () => "r", link, resend),
      ).toBe(false);
      expect(engineScanOf(session)).toBeNull();
    });
  });

  it("gives a scan that stops saying anything up, and says so", () => {
    const link = new FakeLink();
    link.scan(true, 1, 100);
    const resend = vi.fn();
    expect(scanHolds(session, "/w/external.k7", () => "r", link, resend)).toBe(
      true,
    );
    vi.advanceTimersByTime(SCAN_STALL_MS + 2_000);
    return vi.waitFor(() => {
      expect(resend).toHaveBeenCalledTimes(1);
      expect(engineScanOf(session)?.stalled).toBe(true);
      expect(
        scanHolds(session, "/w/external.k7", () => "r", link, resend),
      ).toBe(false);
    });
  });

  it("resends at once when the link goes, so the next one is judged", () => {
    const link = new FakeLink();
    link.scan(true, 1, 4);
    const resend = vi.fn();
    scanHolds(session, "/w/external.k7", () => "r", link, resend);
    link.emit("close");
    return vi.waitFor(() => expect(resend).toHaveBeenCalledTimes(1));
  });

  it("drops the hold of a load another project replaced", () => {
    const link = new FakeLink();
    link.scan(true, 1, 4);
    const resend = vi.fn();
    scanHolds(session, "/w/external.k7", () => "r", link, resend);
    expect(scanHolds(session, "/w/builtin.k7", () => "r", link, resend)).toBe(
      false,
    );
    expect(loadPhase(session)).toBe("copying");
    link.scan(false, 4, 4, 1);
    expect(resend).not.toHaveBeenCalled();
  });
});
