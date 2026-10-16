import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceTokens, LAST_SEEN_STEP_MS } from "./deviceTokens.ts";

let root: string;
let tokens: DeviceTokens;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "device-tokens-"));
  tokens = new DeviceTokens(Buffer.from("test-key"), (slug) =>
    join(root, slug),
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a device token", () => {
  it("names the person who paired, when there was one", () => {
    const { token } = tokens.mint("acct", "laptop", "sub-123");
    expect(tokens.verify(token)).toMatchObject({
      slug: "acct",
      person: "sub-123",
    });
    const bare = tokens.mint("acct", "phone").token;
    expect(tokens.verify(bare)?.person).toBeUndefined();
  });

  it("cannot be given another person: the payload is signed", () => {
    const { token } = tokens.mint("acct", "laptop", "sub-123");
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ s: "acct", d: "x", p: "someone-else" }),
    ).toString("base64url");
    expect(tokens.verify(`${forged}.${sig}`)).toBeNull();
  });

  it("rewrites the device list only when lastSeen moves by a step", () => {
    const { token } = tokens.mint("acct", "laptop");
    const file = join(root, "acct", ".sync-relay", "devices.json");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000_000_000);
      tokens.verify(token);
      const first = readFileSync(file, "utf8");
      const ino = statSync(file).ino;
      vi.setSystemTime(1_000_000_000_000 + LAST_SEEN_STEP_MS - 1);
      expect(tokens.verify(token)).not.toBeNull();
      expect(readFileSync(file, "utf8")).toBe(first);
      expect(statSync(file).ino).toBe(ino);
      vi.setSystemTime(1_000_000_000_000 + LAST_SEEN_STEP_MS);
      tokens.verify(token);
      expect(tokens.list("acct")[0].lastSeen).toBe(
        1_000_000_000_000 + LAST_SEEN_STEP_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
