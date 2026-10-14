import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeviceTokens } from "./deviceTokens.ts";

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
});
