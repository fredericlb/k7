// syncLinks.test.ts — how the home page names a workspace's link: nothing with one, `host · account` with several,
// two accounts on one server told apart by their ids.

import type { WorkspaceSyncStatus } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { entryLabel, linkOfEntry, moveTargetsOf } from "./syncLinks";

const A = "https://app.k7.rocks";
const two: WorkspaceSyncStatus = {
  paired: true,
  server: A,
  servers: [
    { origin: A, main: true, id: "mine", as: "me@x" },
    { origin: A, main: false, id: "band", as: "band@x" },
  ],
  workspaces: [
    { name: "solo", state: "synced", server: A, link: "mine" },
    { name: "gig", state: "synced", server: A, link: "band" },
  ],
};

describe("a workspace's link", () => {
  it("is not named while there is one link", () => {
    const one = { ...two, servers: two.servers?.slice(0, 1) };
    expect(entryLabel(one, one.workspaces[0])).toBe("");
  });

  it("is named host · account with several, by its id on a shared server", () => {
    expect(entryLabel(two, two.workspaces[1])).toBe("app.k7.rocks · band@x");
    expect(linkOfEntry(two, two.workspaces[0])?.id).toBe("mine");
  });

  it("may go to every other link, by id", () => {
    expect(moveTargetsOf(two, two.workspaces[0])).toEqual([
      { ref: "band", label: "app.k7.rocks · band@x" },
    ]);
  });
});
