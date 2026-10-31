import { describe, expect, it } from "vitest";
import { hostOf, sendRefusal, serverLabel } from "./consolidation";

const server = (online: boolean) => ({
  id: "active",
  origin: "https://active.test",
  as: "me@band",
  online,
});

describe("sending a moment to the active server", () => {
  it("goes when the server answers and does not hold the moment", () => {
    expect(sendRefusal(server(true))).toBeNull();
  });

  it("is refused with no server, with the server away, and once it holds the moment", () => {
    expect(sendRefusal(null)).toBe("none");
    expect(sendRefusal(server(false))).toBe("offline");
    const done = [
      { link: "active", origin: "https://active.test", as: "me@band", at: "" },
    ];
    expect(sendRefusal(server(true), done)).toBe("already");
  });
});

describe("a server's label", () => {
  it("is its host and the account", () => {
    expect(serverLabel({ origin: "https://app.k7.rocks", as: "fred" })).toBe(
      "app.k7.rocks · fred",
    );
    expect(hostOf("not a url")).toBe("not a url");
  });
});
