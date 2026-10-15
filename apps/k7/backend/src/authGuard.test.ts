import { describe, expect, it } from "vitest";
import { authRefusals, DEFAULT_SESSION_SECRET } from "./authGuard.ts";

const good = {
  OIDC_ISSUER: "https://login.example",
  OIDC_CLIENT_ID: "k7",
  SESSION_SECRET: "x".repeat(32),
};

describe("authRefusals", () => {
  it("lets a configured production start", () => {
    expect(authRefusals(good)).toEqual([]);
  });

  it("refuses a missing issuer or client id", () => {
    expect(authRefusals({ ...good, OIDC_ISSUER: "" })).toHaveLength(1);
    expect(authRefusals({ ...good, OIDC_CLIENT_ID: undefined })).toHaveLength(
      1,
    );
  });

  it("refuses an unset, default or short secret", () => {
    for (const SESSION_SECRET of [
      undefined,
      "",
      DEFAULT_SESSION_SECRET,
      "x".repeat(31),
    ])
      expect(authRefusals({ ...good, SESSION_SECRET })).toHaveLength(1);
  });

  it("reports every reason at once", () => {
    expect(authRefusals({})).toHaveLength(2);
  });

  it("lets the device's local user and an explicit dev session through", () => {
    expect(authRefusals({ STUDIO_LOCAL_USER: "1" })).toEqual([]);
    expect(authRefusals({ STUDIO_DEV_AUTH: "1" })).toEqual([]);
    expect(authRefusals({ STUDIO_DEV_AUTH: "true" })).toHaveLength(2);
  });

  it("accepts the secret the desktop and the phone generate", () => {
    expect(authRefusals({ ...good, SESSION_SECRET: "ab".repeat(32) })).toEqual(
      [],
    );
  });
});
