// api.ts — the media library's routes on the host's backend, under `apiBase()`. The catalogue lives
// there, so browsing it needs no engine and no local service. The base is read at CALL time, the
// host setting it once through `configureLibrary` (../docs/host.md).

import { type EngineAccess, engineAccess } from "@studio/engine-browser/access";
import { failed, readJson as json } from "@studio/http-client/call";
import type {
  LibraryPlacement,
  ServerReach,
  SongSyncJob,
} from "@studio/mediatek/types";
import type {
  PublicEngine,
  SeparateJob,
  StemsReply,
} from "@studio/web-protocol";
import type {
  HuntFileAs,
  HuntIdentity,
  HuntList,
  HuntRecord,
  HuntTags,
} from "@studio/web-protocol/hunt";
import type {
  SlskdCheck,
  SlskdSettings,
  SlskdSettingsInput,
} from "@studio/web-protocol/settings";
import { apiBase, hostBase, serverBase } from "./config";
import {
  type LibraryClient,
  libraryAt,
  request,
  TIMEOUT_MS,
} from "./libraryClient";
// Type only, so the cycle with prefs.ts never reaches the bundle — see ../docs/api.md.
import type { Pl8Prefs } from "./prefs";

export { type LibraryClient, libraryAt, SongExists } from "./libraryClient";

type Engines = EngineAccess<PublicEngine, Pl8Prefs>;
let access: { base: string; engines: Engines } | null = null;

/** THE engine registry, this machine's, bound to the CURRENT base and rebuilt only when the host moves it (../docs/api.md). */
export function engines(): Engines {
  const base = hostBase();
  if (access?.base !== base)
    access = {
      base,
      engines: engineAccess<PublicEngine, Pl8Prefs>(base, json),
    };
  return access.engines;
}

// `/api/projects` and `/api/shares` are this service's routes, called from k7 (../docs/api.md).

/** `/api/hunt`, on the server the pages read: what it finds lands in that server's library (../docs/hunt.md). */
const hget = async <T>(path: string, what: string): Promise<T> =>
  json(await request(`${apiBase()}/api/hunt${path}`), what);

/** Finding a song on Soulseek. Starting one ANSWERS AT ONCE with the row — see ../docs/hunt.md. */
export const hunt = {
  list: () => hget<HuntList>("", "hunt"),

  /** The recording a query WOULD hunt, downloading nothing; null when nothing matches. */
  identify: async (query: string): Promise<HuntTags | null> =>
    (
      await hget<HuntIdentity>(
        `/identify?${new URLSearchParams({ q: query })}`,
        "identify",
      )
    ).tags,

  /** A hunt files the song into the media library and stops there: `tags` searched as given, `fileAs` naming its folder. */
  start: async (
    query: string,
    tags?: HuntTags,
    fileAs?: HuntFileAs,
  ): Promise<HuntRecord> =>
    json(
      await request(`${apiBase()}/api/hunt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, tags, fileAs }),
      }),
      "hunt",
    ),

  /** The fallback on a failed row: retry THAT hunt through YouTube, so the tags file it in the same place. */
  youtube: async (id: string): Promise<HuntRecord> =>
    json(
      await request(`${apiBase()}/api/hunt/${encodeURIComponent(id)}/youtube`, {
        method: "POST",
      }),
      "youtube",
    ),

  /** Cancels it if it is still running, and takes the row off the list either way. */
  forget: async (id: string): Promise<void> => {
    await json(
      await request(`${apiBase()}/api/hunt/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
      "hunt",
    );
  },
};

/** No engine is online to cut on: the one refusal of a cut the user can act on, so told apart. */
export class NoCutter extends Error {}

/** `/api/stems` — a song's instrumental, cut by an engine and kept beside its master (apps/k7/backend/docs/media/stems.md). */
export const stems = {
  /** Already cut, or being cut for this account now: `job` is the running cut, null when there is none. */
  held: async (master: string): Promise<StemsReply> =>
    json(
      await request(
        `${apiBase()}/api/stems/held?${new URLSearchParams({ song: master, want: "instrumental" })}`,
      ),
      "stems",
    ),

  /** Start the cut, or join the one running: the job's id is the song's, so asking twice asks once. */
  instrumental: async (master: string): Promise<StemsReply> => {
    const res = await request(`${apiBase()}/api/stems`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ song: master, want: "instrumental" }),
    });
    if (res.status === 409) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new NoCutter(b.error ?? "no engine");
    }
    if (!res.ok) throw await failed(res, "stems");
    return json(res, "stems");
  },

  /** How a cut is getting on; null once it is forgotten, which means "look at the disk". */
  job: async (id: string): Promise<SeparateJob | null> => {
    const res = await request(
      `${apiBase()}/api/stems/${encodeURIComponent(id)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw await failed(res, "stems");
    return json(res, "stems");
  },
};

/** The instance's slskd settings — the secrets go in and never come back (../docs/settings.md). */
export const settings = {
  slskd: async (): Promise<SlskdSettings> =>
    json(await request(`${hostBase()}/api/settings/slskd`), "settings"),

  saveSlskd: async (input: SlskdSettingsInput): Promise<SlskdSettings> =>
    json(
      await request(`${hostBase()}/api/settings/slskd`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      "settings",
    ),

  /** Tests what is SAVED, not what is typed: the screen saves first. */
  checkSlskd: async (): Promise<SlskdCheck> =>
    json(
      await request(
        `${hostBase()}/api/settings/slskd/check`,
        { method: "POST" },
        2 * TIMEOUT_MS,
      ),
      "settings",
    ),
};

/** This machine's placements against its paired server, on the HOST's backend whatever the pages read (../../mediatek/docs/serverCopy.md). */
const serverCopy = {
  /** Where each entry lives on a machine paired with a server. */
  placement: async (family: string): Promise<LibraryPlacement> =>
    json(
      await request(
        `${hostBase()}/api/sync/library?family=${encodeURIComponent(family)}`,
      ),
      "placement",
    ),

  /** Bring entries down — one, an album, a playlist's; `follow` keeps each song in step with the server; unbounded, a master is long. */
  download: async (
    family: string,
    paths: string[],
    follow = false,
  ): Promise<void> => {
    await json(
      await request(
        `${hostBase()}/api/sync/library/download`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ family, paths, follow }),
        },
        null,
      ),
      "download",
    );
  },

  /** Whether the paired server answers now, as this machine's backend last saw it. */
  status: async (): Promise<ServerReach> =>
    json(await request(`${hostBase()}/api/sync/library/status`), "status"),

  /** The backend's own jobs over the songs that follow the server: the update check, and each song it refreshes. */
  jobs: async (): Promise<SongSyncJob[]> =>
    (
      await json<{ jobs: SongSyncJob[] }>(
        await request(`${hostBase()}/api/sync/library/jobs`),
        "jobs",
      )
    ).jobs,
};

/** The library the pages read, and this machine's placements beside it. */
export const library = { ...libraryAt(apiBase), ...serverCopy };

let atServer: { base: string; client: LibraryClient } | null = null;

/** The paired server's library through this machine's forward, or null where the host set none (../docs/songSource.md). */
export function serverLibrary(): LibraryClient | null {
  const base = serverBase();
  if (base === null) return null;
  if (atServer?.base !== base)
    atServer = { base, client: libraryAt(() => base) };
  return atServer.client;
}
