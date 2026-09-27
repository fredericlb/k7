// `project libraries update`: the account's libraries are the FILE SERVICE's to keep, so the verb is
// handed the sync (`CommandHost.updateLibraries`) and only says what it did. What would be wrong
// silently: a host that cannot sync reading as "up to date", and a song left compiled against the
// modules it had before an update moved them. See packages/file-service/docs/libraries.md.

import { describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import type { CommandHost } from "./commands";

type Sync = NonNullable<CommandHost["updateLibraries"]>;

function host(updateLibraries?: Sync) {
  const logs: string[] = [];
  const refusals: string[] = [];
  let reloads = 0;
  const h = {
    songPath: "/nowhere/song.st0",
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {
      reloads++;
    },
    ...(updateLibraries ? { updateLibraries } : {}),
  } as never;
  return { h, logs, refusals, reloads: () => reloads };
}

describe("project libraries update", () => {
  it("refuses, and says why, on a host that keeps no libraries", async () => {
    const t = host();
    await runCommand("project libraries update", t.h, "cli");
    expect(t.refusals.join(" ")).toMatch(/file service/);
    expect(t.logs).toEqual([]);
  });

  it("refuses an account with no library at all rather than reading as up to date", async () => {
    const t = host(async () => []);
    await runCommand("project libraries update", t.h, "cli");
    expect(t.refusals.join(" ")).toMatch(/no libraries/);
  });

  it("says what happened to each library, by name", async () => {
    const t = host(async () => [
      { name: "st0", state: "updated", note: "updated to abc1234" },
      { name: "drums", state: "current", note: "up to date" },
    ]);
    await runCommand("project libraries update", t.h, "cli");
    expect(t.logs).toEqual(["st0: updated to abc1234", "drums: up to date"]);
  });

  it("reloads the open song when a library MOVED, and only then", async () => {
    const moved = host(async () => [
      { name: "st0", state: "updated", note: "updated to abc1234" },
    ]);
    await runCommand("project libraries update", moved.h, "cli");
    expect(moved.reloads()).toBe(1);

    const still = host(async () => [
      { name: "st0", state: "current", note: "up to date" },
      { name: "drums", state: "kept", note: "not updated: holds 1 file(s)" },
    ]);
    await runCommand("project libraries update", still.h, "cli");
    expect(still.reloads()).toBe(0);
  });
});
