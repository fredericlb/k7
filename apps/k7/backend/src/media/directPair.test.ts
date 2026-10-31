// directPair.test.ts — what k7 takes as the provider's word on a token, and which side of the direct pairing the env opens.

import { describe, expect, it } from "vitest";
import { directPairFromEnv, providerWord } from "./directPair.ts";

type Bag = Record<string, unknown> | null;
const provider = (
  info: Bag,
  intro: Bag,
  issuer: string | null = "https://idp",
) => ({
  issuer,
  accessToken: async () => "at",
  userinfoFor: async () => info,
  introspect: async () => intro,
});
const EVE = { sub: "s1", email: "eve@example.com" };

describe("providerWord", () => {
  it("takes the client from introspection when this server may introspect", async () => {
    const word = await providerWord(
      provider(
        { ...EVE, azp: "ignored" },
        { active: true, sub: "s1", client_id: "desktop" },
      ),
      "t",
    );
    expect(word).toEqual({ email: EVE.email, sub: "s1", clientId: "desktop" });
  });

  it("falls back on UserInfo's azp when it may not", async () => {
    expect(
      (await providerWord(provider({ ...EVE, azp: "desktop" }, null), "t"))
        ?.clientId,
    ).toBe("desktop");
    expect((await providerWord(provider(EVE, null), "t"))?.clientId).toBeNull();
  });

  it("refuses an inactive token, another subject, an unverified email, a refused token", async () => {
    expect(
      await providerWord(provider(EVE, { active: false }), "t"),
    ).toBeNull();
    expect(
      await providerWord(
        provider(EVE, { active: true, sub: "s2", client_id: "d" }),
        "t",
      ),
    ).toBeNull();
    expect(
      await providerWord(
        provider({ ...EVE, email_verified: false }, null),
        "t",
      ),
    ).toBeNull();
    expect(await providerWord(provider(null, null), "t")).toBeNull();
  });
});

describe("directPairFromEnv", () => {
  it("opens nothing without its env, or without a provider", () => {
    expect(directPairFromEnv(provider(null, null), true, {})).toBeUndefined();
    expect(directPairFromEnv(provider(null, null), false, {})).toBeUndefined();
    expect(
      directPairFromEnv(provider(null, null, null), false, {
        STUDIO_PAIR_CLIENTS: "desktop",
      }),
    ).toBeUndefined();
  });

  it("opens the machine's side on a local instance, the server's on a server", () => {
    const local = directPairFromEnv(provider(null, null), true, {
      STUDIO_DIRECT_PAIR_SERVERS: "app.k7.rocks, https://k7.example.org",
    });
    expect(local?.client?.servers).toEqual(["app.k7.rocks", "k7.example.org"]);
    expect(local?.server).toBeUndefined();
    const server = directPairFromEnv(provider(null, null), false, {
      STUDIO_PAIR_CLIENTS: "st0-desktop,k7-phone",
    });
    expect(server?.server?.clients).toEqual(["st0-desktop", "k7-phone"]);
    expect(server?.client).toBeUndefined();
  });
});
