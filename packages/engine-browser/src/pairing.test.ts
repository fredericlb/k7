// pairing.test.ts — the device's side of LAN pairing that needs no engine: the key kept per ENGINE and shown
// on every socket to an address that engine answered at, and refused storage costing the key, not the page.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deviceName,
  forgetPairKey,
  noteEngineAt,
  pairFrameFor,
  pairKeyFor,
  rememberPairKey,
} from "./pairing.ts";

/** The Storage this module touches, held in a map — the suite runs under Node, which has none. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe("pairing keys", () => {
  beforeEach(() => {
    globalThis.localStorage = fakeStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("keeps one key per engine", () => {
    rememberPairKey("eng-a", "k1");
    expect(pairKeyFor("eng-a")).toBe("k1");
    expect(pairKeyFor("eng-b")).toBeNull();
    forgetPairKey("eng-a");
    expect(pairKeyFor("eng-a")).toBeNull();
  });

  // A client opens a URL, not an engine: the key travels only to an address the probe saw that engine answer at.
  it("sends the key first to an address its engine answered at", () => {
    rememberPairKey("eng-a", "k1");
    noteEngineAt("ws://192.168.1.10:8765", "eng-a");
    expect(JSON.parse(pairFrameFor("ws://192.168.1.10:8765") ?? "{}")).toEqual({
      type: "pair",
      key: "k1",
    });
    expect(pairFrameFor("ws://192.168.1.99:8765")).toBeNull();
  });

  it("sends nothing to an engine it holds no key for", () => {
    noteEngineAt("ws://192.168.1.11:8765", "eng-b");
    expect(pairFrameFor("ws://192.168.1.11:8765")).toBeNull();
  });
});

describe("refused storage", () => {
  // A private window throws on storage: no key, and no exception in front of the page.
  it("is no key, not an error", () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(() => rememberPairKey("eng-a", "k")).not.toThrow();
    expect(pairKeyFor("eng-a")).toBeNull();
    expect(() => forgetPairKey("eng-a")).not.toThrow();
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });
});

describe("deviceName", () => {
  it("names a device the musician can recognise", () => {
    expect(deviceName()).toMatch(/ · /);
  });
});
