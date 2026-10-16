// api.ts — every call the rehearsal pages make, as one `api` object spread from a module per domain
// under api/. Every call sends the session cookie under the base the host configured (config.ts).

import { momentsApi } from "./api/moments";
import { loginUrl, pagesApi } from "./api/pages";
import { releasesApi } from "./api/releases";
import { rtcApi } from "./api/rtc";
import { sessionsApi } from "./api/sessions";
import { singingApi } from "./api/singing";
import { songsApi } from "./api/songs";
import { tokensApi } from "./api/tokens";

export {
  ApiError,
  type ApiToken,
  type OnProgress,
  UnauthenticatedError,
} from "./api/http";

export const api = {
  ...sessionsApi,
  ...momentsApi,
  ...releasesApi,
  ...tokensApi,
  ...pagesApi,
  ...singingApi,
  ...songsApi,
  ...rtcApi,
  // A getter, read where it is used: spread, it would read the tab's address once, at import.
  get loginUrl(): string {
    return loginUrl();
  },
};
