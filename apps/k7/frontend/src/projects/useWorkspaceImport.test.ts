import type { WorkspaceSyncStatus } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { importLanded } from "./useWorkspaceImport";

const status = (
  workspaces: WorkspaceSyncStatus["workspaces"],
): WorkspaceSyncStatus => ({ paired: true, server: "https://s", workspaces });

describe("importLanded", () => {
  it("waits while the workspace is still the server's only, or here but not synced", () => {
    expect(
      importLanded(
        status([{ name: "band", state: "server", server: "https://s" }]),
        "band",
      ),
    ).toBe(false);
    expect(
      importLanded(
        status([{ name: "band", state: "local", server: "https://s" }]),
        "band",
      ),
    ).toBe(false);
  });
  it("is done once it is synced, under its own name or a renamed folder", () => {
    expect(
      importLanded(
        status([{ name: "band", state: "synced", server: "https://s" }]),
        "band",
      ),
    ).toBe(true);
    expect(
      importLanded(
        status([
          {
            name: "band.s",
            room: "band",
            state: "synced",
            server: "https://s",
          },
        ]),
        "band",
      ),
    ).toBe(true);
  });
});
