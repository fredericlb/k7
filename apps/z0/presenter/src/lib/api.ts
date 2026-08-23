import { createApiClient } from "@frediverse/api-client";

// The SERVICE prefix, not the SPA's: from BASE_URL a nested app would ask itself for /api.
const client = createApiClient({ basePath: "/z0" });

// The session cookie always rides along; the raw Response comes back for the caller to read.
export const f = (path: string, init?: RequestInit): Promise<Response> =>
  client.raw(path, init);
