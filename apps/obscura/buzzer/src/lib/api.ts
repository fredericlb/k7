import { createApiClient } from "@frediverse/api-client";

// Single-origin: the SPA is served under its own path prefix and the backend at
// /api on the same host (Caddy in dev, the image's nginx in prod), so paths stay
// relative — there is no API origin to configure.
//
// basePath is the SERVICE prefix, not the SPA's: obscura is mounted at /obscura
// and its backend answers under /obscura/api, while a SPA may sit deeper (at
// /obscura/buzzer/). Deriving it from BASE_URL would be wrong for the nested
// ones — they would ask for /obscura/buzzer/api/... and be handed the SPA.
const client = createApiClient({ basePath: "/obscura" });

// All calls send the session cookie (createApiClient defaults to
// credentials: "include"). Returns the raw Response so callers keep doing their
// own status/JSON handling.
export const f = (path: string, init?: RequestInit): Promise<Response> =>
  client.raw(path, init);
