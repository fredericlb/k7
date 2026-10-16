// shellPolicy.test.ts — the shell's two decisions as this app makes them: which URL reaches the OS, which frame gets a permission.

import {
  DEFAULT_GRANTS,
  externalUrl,
  type PermissionAsk,
  permissionAllowed,
} from "@frediverse/electron-shell/policy";
import { describe, expect, it } from "vitest";

describe("externalUrl", () => {
  it.each([
    ["https://app.k7.rocks/docs", "https://app.k7.rocks/docs"],
    ["http://example.com", "http://example.com/"],
    ["mailto:someone@example.com", "mailto:someone@example.com"],
    ["HTTPS://EXAMPLE.COM/a", "https://example.com/a"],
  ])("passes %s", (raw, out) => expect(externalUrl(raw)).toBe(out));

  it.each([
    "file:///etc/passwd",
    "file://server/share/x.exe",
    "smb://attacker/share",
    "ms-msdt:/id PCWDiagnostic",
    "search-ms:query=x&crumb=location:\\\\attacker\\share",
    "javascript:alert(1)",
    "vscode://file/x",
    "data:text/html,<b>x</b>",
    "https://user:pass@example.com/",
    "https://user@example.com/",
    "not a url",
    "",
  ])("refuses %s", (raw) => expect(externalUrl(raw)).toBeNull());
});

const K7 = "http://127.0.0.1:18789";
const policy = {
  origins: [K7],
  grants: { ...DEFAULT_GRANTS, media: "app" as const, midi: "app" as const },
};
const ask = (o: Partial<PermissionAsk>): PermissionAsk => ({
  permission: "media",
  requesting: `${K7}/rehearsal`,
  top: `${K7}/rehearsal`,
  mainFrame: true,
  ...o,
});

describe("permissionAllowed", () => {
  it("grants what is listed to the app's top frame", () => {
    for (const permission of [
      "media",
      "midi",
      "clipboard-sanitized-write",
      "fullscreen",
    ])
      expect(permissionAllowed(policy, ask({ permission }))).toBe(true);
  });

  it("grants an `app` permission to an app frame inside an app page, not a `top` one", () => {
    const framed = ask({ requesting: `${K7}/@banc/x`, mainFrame: false });
    expect(permissionAllowed(policy, framed)).toBe(true);
    expect(
      permissionAllowed(policy, {
        ...framed,
        permission: "clipboard-sanitized-write",
      }),
    ).toBe(false);
  });

  it("keeps the default `top` scope for media when the app does not widen it", () => {
    const strict = { origins: [K7], grants: DEFAULT_GRANTS };
    expect(permissionAllowed(strict, ask({ mainFrame: false }))).toBe(false);
    expect(permissionAllowed(strict, ask({}))).toBe(true);
  });

  it("refuses a foreign frame, and an app frame inside a foreign page", () => {
    expect(
      permissionAllowed(
        policy,
        ask({ requesting: "https://evil.example", mainFrame: false }),
      ),
    ).toBe(false);
    expect(
      permissionAllowed(policy, ask({ top: "https://evil.example/" })),
    ).toBe(false);
    expect(
      permissionAllowed(policy, ask({ requesting: "http://127.0.0.1:9999" })),
    ).toBe(false);
  });

  it("refuses every permission it does not list, to the app too", () => {
    for (const permission of [
      "geolocation",
      "notifications",
      "openExternal",
      "clipboard-read",
      "midiSysex",
      "display-capture",
      "hid",
      "unknown",
      "toString",
      "__proto__",
    ])
      expect(permissionAllowed(policy, ask({ permission }))).toBe(false);
  });

  it("refuses an opaque or missing origin", () => {
    expect(permissionAllowed(policy, ask({ requesting: "null" }))).toBe(false);
    expect(permissionAllowed(policy, ask({ requesting: undefined }))).toBe(
      false,
    );
    expect(permissionAllowed(policy, ask({ top: "about:blank" }))).toBe(false);
  });
});
