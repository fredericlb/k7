// Tests for the CORS origin policy — the control that stops a page you happen to visit from driving this
// service (cors.ts has the full reasoning). Worth testing properly despite the rest of this package having no
// tests: the policy is security-load-bearing, and the private-network range has fiddly boundaries.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { studioDir, webOriginsPath } from "@studio/engine-client/paths";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { allowedOrigin } from "./cors.ts";

const ENV_KEYS = ["STUDIO_WEB_ORIGIN", "STUDIO_REGISTRY_URL"] as const;

// These write the REAL `~/.studio/web-origins.json`, shared with the tray, and must put it back.
const ORIGINS_PATH = webOriginsPath();
let saved: string | null = null;

beforeAll(() => {
  saved = existsSync(ORIGINS_PATH) ? readFileSync(ORIGINS_PATH, "utf8") : null;
});
afterAll(() => {
  if (saved === null) rmSync(ORIGINS_PATH, { force: true });
  else writeFileSync(ORIGINS_PATH, saved, "utf8");
});

function writeOrigins(origins: unknown): void {
  mkdirSync(studioDir(), { recursive: true });
  writeFileSync(ORIGINS_PATH, JSON.stringify({ origins }), "utf8");
}

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  rmSync(ORIGINS_PATH, { force: true });
});

describe("allowedOrigin — default policy", () => {
  it("refuses a public origin (this is the drive-by we are blocking)", () => {
    expect(allowedOrigin("https://evil.com")).toBe(false);
    expect(allowedOrigin("http://evil.com")).toBe(false);
    expect(allowedOrigin("https://st0.example.org")).toBe(false);
  });

  it("allows the dev frontend on either loopback spelling", () => {
    expect(allowedOrigin("http://localhost:5203")).toBe(true);
    expect(allowedOrigin("http://127.0.0.1:5203")).toBe(true);
  });

  it("allows loopback on ANY port, since `st0 --web` picks a free one", () => {
    // The host carries the trust, not the port; asserted so nobody "tightens" it to a fixed one.
    expect(allowedOrigin("http://localhost:5999")).toBe(true);
    expect(allowedOrigin("http://127.0.0.1:1234")).toBe(true);
  });

  it("allows private-network origins (Tier 2: engine driven from the LAN)", () => {
    expect(allowedOrigin("http://192.168.1.5:5203")).toBe(true);
    expect(allowedOrigin("http://10.0.0.5:5203")).toBe(true);
  });

  it("gets the RFC1918 172.16/12 boundaries right", () => {
    expect(allowedOrigin("http://172.16.0.1:5203")).toBe(true);
    expect(allowedOrigin("http://172.31.255.4:5203")).toBe(true);
    expect(allowedOrigin("http://172.15.0.1:5203")).toBe(false);
    expect(allowedOrigin("http://172.32.0.1:5203")).toBe(false);
  });

  it("is not fooled by a hostname that merely contains a private one", () => {
    expect(allowedOrigin("http://localhost.evil.com")).toBe(false);
    expect(allowedOrigin("http://127.0.0.1.evil.com")).toBe(false);
    expect(allowedOrigin("http://evil.com#localhost")).toBe(false);
  });

  it("allows a request with no Origin at all (curl, the CLI, native clients)", () => {
    // CORS is a browser-only control; refusing header-less callers protects nothing.
    expect(allowedOrigin(undefined)).toBe(true);
  });

  it("allows the hosted backend's own origin", () => {
    process.env.STUDIO_REGISTRY_URL = "https://daw.example.org/api";
    expect(allowedOrigin("https://daw.example.org")).toBe(true);
    expect(allowedOrigin("https://other.example.org")).toBe(false);
  });

  // An engine announces to several registries, and reading only the first CORS-refused the médiathèque.
  it("allows EVERY origin in a comma-separated registry list", () => {
    process.env.STUDIO_REGISTRY_URL =
      "https://daw.example.org/api, https://media.example.org/api";
    expect(allowedOrigin("https://daw.example.org")).toBe(true);
    expect(allowedOrigin("https://media.example.org")).toBe(true);
    expect(allowedOrigin("https://other.example.org")).toBe(false);
  });

  it("survives a malformed origin or registry url without throwing", () => {
    process.env.STUDIO_REGISTRY_URL = "not a url";
    expect(allowedOrigin("also not a url")).toBe(false);
    expect(allowedOrigin("null")).toBe(false);
  });

  // The list is hand-edited through an env var, so a stray comma must not lock every service out.
  it("keeps the good entries when one url in the list is malformed", () => {
    process.env.STUDIO_REGISTRY_URL = "not a url,https://media.example.org";
    expect(allowedOrigin("https://media.example.org")).toBe(true);
  });
});

describe("allowedOrigin — web UIs added from the tray", () => {
  it("allows an origin the user added, which no other rule would", () => {
    // A reverse-proxied web UI is neither loopback nor private, which is why the tray writes this file.
    expect(allowedOrigin("https://daw.test")).toBe(false);
    writeOrigins(["https://daw.test"]);
    expect(allowedOrigin("https://daw.test")).toBe(true);
  });

  it("takes effect WITHOUT a restart, and stops when the entry goes", () => {
    // Why the file is re-read per call: adding a web UI in the menu bar must not need a restart.
    writeOrigins(["https://daw.test"]);
    expect(allowedOrigin("https://daw.test")).toBe(true);
    writeOrigins(["https://other.test"]);
    expect(allowedOrigin("https://daw.test")).toBe(false);
    expect(allowedOrigin("https://other.test")).toBe(true);
  });

  it("keeps the loopback defaults alongside it (additive, not a replacement)", () => {
    writeOrigins(["https://daw.test"]);
    expect(allowedOrigin("http://localhost:5223")).toBe(true);
  });

  it("normalises a stored URI down to its origin", () => {
    // The user types a URL from the address bar; the browser sends a bare origin.
    writeOrigins(["https://daw.test/", "https://alt.test/editor?x=1"]);
    expect(allowedOrigin("https://daw.test")).toBe(true);
    expect(allowedOrigin("https://alt.test")).toBe(true);
  });

  it("admits nothing from a malformed or junk-filled file", () => {
    writeOrigins(["not a url", 42, null, ""]);
    expect(allowedOrigin("https://daw.test")).toBe(false);
    expect(allowedOrigin("not a url")).toBe(false);
    writeFileSync(ORIGINS_PATH, "{ this is not json", "utf8");
    expect(allowedOrigin("https://daw.test")).toBe(false);
    // ...and a broken file must not take the defaults down with it.
    expect(allowedOrigin("http://localhost:5223")).toBe(true);
  });

  it("is still outranked by STUDIO_WEB_ORIGIN", () => {
    // An operator who pinned the origins meant it; the tray's list must not widen that lockdown.
    writeOrigins(["https://daw.test"]);
    process.env.STUDIO_WEB_ORIGIN = "https://pinned.example.org";
    expect(allowedOrigin("https://daw.test")).toBe(false);
    expect(allowedOrigin("https://pinned.example.org")).toBe(true);
  });
});

describe("allowedOrigin — STUDIO_WEB_ORIGIN is total", () => {
  it("allows exactly the listed origins and nothing else", () => {
    process.env.STUDIO_WEB_ORIGIN =
      "https://daw.example.org, https://alt.example.org";
    expect(allowedOrigin("https://daw.example.org")).toBe(true);
    expect(allowedOrigin("https://alt.example.org")).toBe(true);
    expect(allowedOrigin("https://evil.com")).toBe(false);
  });

  it("suppresses the dev and private-network defaults once set", () => {
    // The escape hatch must be total, or locking down prod would still admit every LAN origin.
    process.env.STUDIO_WEB_ORIGIN = "https://daw.example.org";
    expect(allowedOrigin("http://localhost:5203")).toBe(false);
    expect(allowedOrigin("http://192.168.1.5:5203")).toBe(false);
  });
});
