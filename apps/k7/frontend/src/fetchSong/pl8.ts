// pl8.ts — what "Fetch song" asks pl8 from the page, as the user: the library, a Soulseek hunt, an
// engine and a stems cut. Same origin, the session cookie rides along — ../../../docs/audio.md.
// What reads wrong: the hunt refuses k7's service token on purpose, which is why this runs in the browser.

import type { MediatekEntry } from "@studio/mediatek/types";
import type {
  PublicEngine,
  SeparateJob,
  StemsReply,
} from "@studio/web-protocol";
import type { HuntRecord } from "@studio/web-protocol/hunt";
import { serviceUrl } from "@studio/web-protocol/services";

const PL8 = `${serviceUrl(globalThis.location?.origin ?? "", "pl8")}/api`;

/** A pl8 call with the session; its error text surfaces as is, pl8's wording being the useful one. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PL8}${path}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(said.error ?? `pl8 answered ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export interface Pl8Client {
  listSongs(): Promise<MediatekEntry[]>;
  startHunt(query: string): Promise<HuntRecord>;
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
  startHunt: (query) =>
    call<HuntRecord>("/hunt", {
      method: "POST",
      body: JSON.stringify({ query }),
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
      if ((err as Error & { status?: number }).status === 404) return null;
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
