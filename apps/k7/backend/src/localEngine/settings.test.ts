import { describe, expect, it } from "vitest";
import { pinRegistry } from "./settings.ts";

const LOCAL = "http://127.0.0.1:18789";

describe("pinRegistry", () => {
  it("adds this backend to a fresh machine's settings", () => {
    expect(pinRegistry({}, LOCAL)).toEqual({ registryUrls: [LOCAL] });
  });

  it("keeps the person's instances behind it, and the rest of the file", () => {
    expect(
      pinRegistry(
        { port: 8765, registryUrls: ["https://app.k7.rocks"] },
        LOCAL,
      ),
    ).toEqual({ port: 8765, registryUrls: [LOCAL, "https://app.k7.rocks"] });
  });

  it("moves it first rather than listing it twice, whatever its spelling", () => {
    expect(
      pinRegistry(
        { registryUrls: ["https://app.k7.rocks", `${LOCAL}/`] },
        LOCAL,
      ),
    ).toEqual({ registryUrls: [LOCAL, "https://app.k7.rocks"] });
  });

  it("says nothing changed when it already leads", () => {
    expect(
      pinRegistry({ registryUrls: [LOCAL, "https://app.k7.rocks"] }, LOCAL),
    ).toBeNull();
  });
});
