import { createApiClient } from "@frediverse/api-client";

// Single-origin: the SPA is served under its own path prefix and the backend at
// /api on the same host (Caddy in dev, the image's nginx in prod), so paths stay
// relative — there is no API origin to configure.
//
// No basePath: /api sits at the origin root, not under the SPA's prefix, so a
// SPA served at /buzzer/ still calls /api/... (NOT /buzzer/api/...).
const client = createApiClient();

// All calls send the session cookie (createApiClient defaults to
// credentials: "include"). Returns the raw Response so callers keep doing their
// own status/JSON handling.
export const f = (path: string, init?: RequestInit): Promise<Response> =>
  client.raw(path, init);
