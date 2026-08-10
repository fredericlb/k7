import { createApiClient } from "@frediverse/api-client";

// Single-origin: the SPA is served under its own path prefix and the backend at
// /api on the same host (the LAN proxy in dev, the image's nginx in prod), so paths stay
// relative — there is no API origin to configure.
//
// basePath is the SERVICE prefix, not the SPA's: z0 is mounted at /z0
// and its backend answers under /z0/api, while a SPA may sit deeper (at
// /z0/buzzer/). Deriving it from BASE_URL would be wrong for the nested
// ones — they would ask for /z0/buzzer/api/... and be handed the SPA.
const client = createApiClient({ basePath: "/z0" });

// All calls send the session cookie (createApiClient defaults to
// credentials: "include"). Returns the raw Response so callers keep doing their
// own status/JSON handling.
export const f = (path: string, init?: RequestInit): Promise<Response> =>
  client.raw(path, init);
