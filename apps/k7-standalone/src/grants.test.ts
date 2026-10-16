// grants.test.ts — what K7_GRANTS widens, judged by the shell's own rule; the rule itself is the shell's to test.

import {
  DEFAULT_GRANTS,
  type PermissionAsk,
  permissionAllowed,
} from "@frediverse/electron-shell/policy";
import { describe, expect, it } from "vitest";
import { K7_GRANTS } from "./grants.ts";

const K7 = "http://127.0.0.1:18789";
// The same merge installPermissions makes.
const policy = { origins: [K7], grants: { ...DEFAULT_GRANTS, ...K7_GRANTS } };
// The rehearsal bench: an app frame inside an app page.
const bench = (permission: string): PermissionAsk => ({
  permission,
  requesting: `${K7}/@banc/x`,
  top: `${K7}/rehearsal`,
  mainFrame: false,
});

describe("K7_GRANTS", () => {
  it("lets the bench record, play MIDI and keep the screen awake", () => {
    for (const p of ["media", "midi", "screen-wake-lock"])
      expect(permissionAllowed(policy, bench(p))).toBe(true);
  });

  it("widens nothing else to a frame", () => {
    expect(permissionAllowed(policy, bench("clipboard-sanitized-write"))).toBe(
      false,
    );
    expect(permissionAllowed(policy, bench("midiSysex"))).toBe(false);
  });

  it("gives none of them to an app frame inside a foreign page", () => {
    for (const p of Object.keys(K7_GRANTS))
      expect(
        permissionAllowed(policy, {
          ...bench(p),
          top: "https://evil.example/",
        }),
      ).toBe(false);
  });
});
