import { describe, expect, it } from "vitest";
import {
  hostOf,
  momentsToSend,
  sendRefusal,
  serverLabel,
} from "./consolidation";

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

describe("the moments that go up on their own", () => {
  const moment = (id: string, over: object = {}) => ({
    id,
    sharedFrom: "",
    recordingAvailable: true,
    validated: false,
    ...over,
  });
  const sent = {
    link: "active",
    origin: "https://active.test",
    as: "me@band",
    at: "",
  };

  it("are this machine's, with audio, never sent to the active server", () => {
    const all = [
      moment("new"),
      moment("cut", { recordingAvailable: false, validated: true }),
      moment("sent", { consolidations: [sent] }),
      moment("theirs", { sharedFrom: "Laptop" }),
      moment("silent", { recordingAvailable: false }),
    ];
    expect(momentsToSend(all, server(true)).map((m) => m.id)).toEqual([
      "new",
      "cut",
    ]);
  });

  it("wait while the server is away, or when there is none", () => {
    expect(momentsToSend([moment("new")], server(false))).toEqual([]);
    expect(momentsToSend([moment("new")], null)).toEqual([]);
  });
});
