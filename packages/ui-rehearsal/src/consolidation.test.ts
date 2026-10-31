import { describe, expect, it } from "vitest";
import {
  choosable,
  hostOf,
  preselectServer,
  serverLabel,
} from "./consolidation";

const server = (id: string, online: boolean, main = false) => ({
  id,
  origin: `https://${id}.test`,
  as: `${id}@band`,
  main,
  online,
});

describe("the server a consolidation preselects", () => {
  it("is the main one when it answers", () => {
    expect(
      preselectServer([server("main", true, true), server("b", true)]),
    ).toBe("main");
  });

  it("is the first online one in link order when the main one is away", () => {
    expect(
      preselectServer([
        server("main", false, true),
        server("b", false),
        server("c", true),
        server("d", true),
      ]),
    ).toBe("c");
  });

  it("is none when no server answers, or there is none", () => {
    expect(preselectServer([server("main", false, true)])).toBeNull();
    expect(preselectServer([])).toBeNull();
  });
});

describe("the servers a moment may still go to", () => {
  it("leaves out those it was consolidated on, in their order", () => {
    const all = [server("a", true), server("b", true), server("c", false)];
    const done = [
      { link: "a", origin: "https://a.test", as: "a@band", at: "" },
    ];
    expect(choosable(all, done).map((s) => s.id)).toEqual(["b", "c"]);
    expect(preselectServer(choosable(all, done))).toBe("b");
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
