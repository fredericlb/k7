import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promptAnswered, promptDue } from "./serverPrompt";

/** A Storage held in a Map: the suite runs in node, which has none. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, v),
  };
}

/** A new launch: the session's storage starts empty, the machine's stays. */
const relaunch = () => vi.stubGlobal("sessionStorage", memoryStorage());

describe("serverPrompt", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    relaunch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is due on a first launch with no server", () => {
    expect(promptDue(0)).toBe(true);
  });

  it("is never due once a server is saved", () => {
    expect(promptDue(1)).toBe(false);
  });

  it("comes back next launch while remind stays ticked", () => {
    promptAnswered(true);
    expect(promptDue(0)).toBe(false);
    relaunch();
    expect(promptDue(0)).toBe(true);
  });

  it("stays away for good once remind is unticked", () => {
    promptAnswered(false);
    relaunch();
    expect(promptDue(0)).toBe(false);
  });
});
