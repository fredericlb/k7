import { describe, expect, it } from "vitest";
import { retryDelay } from "./useDocument";

// The backoff behind the three panes' re-ask. Only the POLICY is testable here — nothing in this
// app mounts a component — and it is the half worth pinning: both ends of the curve are load
// bearing, and each was chosen against a real failure rather than picked as a round number.

describe("the retry backoff", () => {
  it("comes back fast on the first try", () => {
    // The failure this exists for is the file service restarting under `tsx`, which is back in a
    // second or two. A first retry any slower leaves the pane dead longer than the outage.
    expect(retryDelay(0)).toBe(500);
  });

  it("doubles", () => {
    expect(retryDelay(1)).toBe(1000);
    expect(retryDelay(2)).toBe(2000);
    expect(retryDelay(3)).toBe(4000);
  });

  it("stops doubling at five seconds, and stays there", () => {
    // The cap is what keeps a genuinely stuck state — "no active project", which no amount of
    // retrying fixes — from becoming a request loop. Without it the tenth attempt would be
    // eight minutes away, which is the same as never for somebody watching the pane.
    expect(retryDelay(4)).toBe(5000);
    expect(retryDelay(10)).toBe(5000);
    expect(retryDelay(100)).toBe(5000);
  });

  it("never returns something a setTimeout would fire immediately on", () => {
    // 2 ** 100 overflows nothing here, but a negative or NaN delay would make setTimeout fire on
    // the next tick and turn the backoff into a spin. One assertion over the whole range.
    for (let n = 0; n < 64; n++)
      expect(retryDelay(n)).toBeGreaterThanOrEqual(500);
  });
});
