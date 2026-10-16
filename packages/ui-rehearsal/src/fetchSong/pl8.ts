// pl8.ts — what "Fetch song" asks pl8 from the page, as the user: the library, a Soulseek hunt, an
// engine and a stems cut. Same origin, the session cookie rides along — ../../docs/audio.md.
// What reads wrong: the hunt refuses k7's service token on purpose, which is why this runs in the browser.

import type { MediatekEntry } from "@studio/mediatek/types";
import type {
  PublicEngine,
  SeparateJob,
  StemsReply,
} from "@studio/web-protocol";
import type {
  HuntIdentity,
  HuntRecord,
  HuntTags,
} from "@studio/web-protocol/hunt";
import { ApiError } from "../api";
import { apiBase } from "../config";
import { m } from "../paraglide/messages.js";

// The media library answers on the same origin as the rehearsal API, so its base is the configured one.
export function pl8Base(): Promise<string> {
  return Promise.resolve(apiBase());
}

/** Where the browser streams a médiathèque file from pl8 itself, with Range; a FLAC comes as its MP3. */
export async function pl8StreamUrl(path: string): Promise<string> {
  return `${await pl8Base()}/api/mediatek/stream?path=${encodeURIComponent(path)}`;
}

/** A pl8 call with the session; its error text surfaces as is, pl8's wording being the useful one. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const pl8Url = await pl8Base();
  const res = await fetch(`${pl8Url}/api${path}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(
      said.error ?? m["common.requestFailed"]({ status: res.status }),
      res.status,
    );
  }
  return (await res.json()) as T;
}

export interface Pl8Client {
  listSongs(): Promise<MediatekEntry[]>;
  /** What MusicBrainz (or Deezer) says a query is — nothing downloaded, so it can be checked first. */
  identify(query: string): Promise<HuntTags | null>;
  /** A hunt of `tags` when given, as checked, rather than of whatever pl8 would identify. */
  startHunt(query: string, tags?: HuntTags): Promise<HuntRecord>;
  hunts(): Promise<HuntRecord[]>;
  engines(): Promise<PublicEngine[]>;
  prepareStems(
    song: string,
    engineId: string,
    want?: CutWant,
  ): Promise<StemsReply>;
  /** Null once pl8 has swept a finished job: the disk is then the one to ask. */
  separation(id: string): Promise<SeparateJob | null>;
  stemsHeld(song: string, want?: CutWant): Promise<boolean>;
}

/** What a cut is asked for: the four parts, or the record without its voice. */
export type CutWant = "stems" | "instrumental";

export const pl8: Pl8Client = {
  listSongs: async () =>
    (await call<{ entries: MediatekEntry[] }>("/mediatek/list?family=songs"))
      .entries,
  identify: async (query) =>
    (await call<HuntIdentity>(`/hunt/identify?q=${encodeURIComponent(query)}`))
      .tags,
  startHunt: (query, tags) =>
    call<HuntRecord>("/hunt", {
      method: "POST",
      body: JSON.stringify({ query, tags }),
    }),
  hunts: async () => (await call<{ hunts: HuntRecord[] }>("/hunt")).hunts,
  engines: () => call<PublicEngine[]>("/engines"),
  prepareStems: (song, engineId, want = "stems") =>
    call<StemsReply>("/stems", {
      method: "POST",
      body: JSON.stringify({ song, engineId, want }),
    }),
  separation: async (id) => {
    try {
      return await call<SeparateJob>(`/stems/${encodeURIComponent(id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  stemsHeld: async (song, want = "stems") =>
    (
      await call<StemsReply>(
        `/stems/held?song=${encodeURIComponent(song)}&want=${want}`,
      )
    ).ready,
};
