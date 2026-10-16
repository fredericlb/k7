// tokens.ts — the personal access tokens the k7 CLI publishes with.

import { type ApiToken, f, json } from "./http";

export const tokensApi = {
  // Mint a personal access token for the k7 CLI (Settings UI): a POST, never a GET.
  createApiToken: (label?: string): Promise<{ token: string } & ApiToken> =>
    f("/api/token/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }).then(json),

  listApiTokens: (): Promise<{ tokens: ApiToken[] }> =>
    f("/api/token/publish").then(json),

  revokeApiToken: (id: string): Promise<{ ok: true }> =>
    f(`/api/token/publish/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(json),
};
