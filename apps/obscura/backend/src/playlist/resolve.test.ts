import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDeezerState } from "./deezer.ts";
import {
  __resetResolveCache,
  parsePlaylistURL,
  resolvePlaylist,
} from "./resolve.ts";
import { __resetSpotifyState } from "./spotify.ts";

// The upstream APIs are stubbed at the global fetch boundary, so these cover
// the real pagination / ISRC-bridge code paths without touching the network.

const dzTrack = (id: number, artist: string, title: string) => ({
  id,
  title,
  title_short: title,
  duration: 200,
  preview: `https://cdn.example/${id}.mp3?hdnea=exp=9999999999`,
  artist: { name: artist },
  album: { cover_medium: `https://cdn.example/${id}.jpg` },
});

/** Route a stubbed fetch by URL substring; unmatched URLs fail loudly. */
function stubFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
    }
    throw new Error(`unstubbed fetch: ${url}`);
  });
}

beforeEach(() => {
  __resetResolveCache();
  __resetDeezerState();
  __resetSpotifyState();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SPOTIFY_CLIENT_ID;
  delete process.env.SPOTIFY_CLIENT_SECRET;
});

describe("parsePlaylistURL", () => {
  it("reads every Deezer shape", () => {
    for (const url of [
      "https://www.deezer.com/fr/playlist/1234",
      "https://www.deezer.com/playlist/1234",
      "https://api.deezer.com/playlist/1234",
      "  https://deezer.com/en/playlist/1234?utm_source=x  ",
      "1234",
    ]) {
      expect(parsePlaylistURL(url)).toEqual({
        provider: "deezer",
        id: "1234",
        url: "https://www.deezer.com/playlist/1234",
      });
    }
  });

  it("reads every Spotify shape", () => {
    for (const url of [
      "https://open.spotify.com/playlist/37i9dQZF1DX",
      "https://open.spotify.com/intl-fr/playlist/37i9dQZF1DX?si=abc",
      "spotify:playlist:37i9dQZF1DX",
    ]) {
      expect(parsePlaylistURL(url)).toEqual({
        provider: "spotify",
        id: "37i9dQZF1DX",
        url: "https://open.spotify.com/playlist/37i9dQZF1DX",
      });
    }
  });

  it("rejects what it can't route", () => {
    expect(() => parsePlaylistURL("")).toThrow(/empty/);
    expect(() => parsePlaylistURL("https://example.com/x")).toThrow(
      /unrecognised/,
    );
    // Album and artist links are the most likely near-misses.
    expect(() => parsePlaylistURL("https://www.deezer.com/album/1234")).toThrow(
      /unrecognised/,
    );
  });

  it("explains shortened Deezer links rather than failing vaguely", () => {
    expect(() => parsePlaylistURL("https://deezer.page.link/abc")).toThrow(
      /shortened/,
    );
  });
});

describe("resolvePlaylist — Deezer", () => {
  it("follows the `next` pagination to the end", async () => {
    const page1 = {
      data: [dzTrack(1, "A", "One"), dzTrack(2, "B", "Two")],
      next: "https://api.deezer.com/playlist/9/tracks?index=2",
    };
    const page2 = { data: [dzTrack(3, "C", "Three")] };
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const body = url.includes("/tracks")
          ? call++ === 0
            ? page1
            : page2
          : { title: "Mix", picture_medium: "cover.jpg", nb_tracks: 3 };
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );

    const out = await resolvePlaylist(parsePlaylistURL("9"));
    expect(out.name).toBe("Mix");
    expect(out.tracks.map((t) => t.deezerId)).toEqual([1, 2, 3]);
    expect(out.tracks.every((t) => t.matchVia === "direct")).toBe(true);
    expect(out.unavailable).toBe(0);
  });

  it("memoises, so a second game start costs no upstream call", async () => {
    const fetchMock = stubFetch({
      "/tracks": { data: [dzTrack(1, "A", "One")] },
      "/playlist/9": { title: "Mix", nb_tracks: 1 },
    });
    vi.stubGlobal("fetch", fetchMock);

    const ref = parsePlaylistURL("9");
    await resolvePlaylist(ref);
    const calls = fetchMock.mock.calls.length;
    await resolvePlaylist(ref);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
});

describe("resolvePlaylist — Spotify bridge", () => {
  beforeEach(() => {
    process.env.SPOTIFY_CLIENT_ID = "id";
    process.env.SPOTIFY_CLIENT_SECRET = "secret";
  });

  it("matches on ISRC, falls back to search, and counts what it drops", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const json = (b: unknown) =>
          new Response(JSON.stringify(b), { status: 200 });

        if (url.includes("accounts.spotify.com"))
          return json({ access_token: "t", expires_in: 3600 });
        if (url.includes("/tracks?fields") || url.includes("/tracks%3F"))
          return json({
            items: [
              {
                track: {
                  name: "One",
                  artists: [{ name: "A" }],
                  external_ids: { isrc: "AAA" },
                },
              },
              { track: { name: "Two", artists: [{ name: "B" }] } },
              {
                track: {
                  name: "Ghost",
                  artists: [{ name: "C" }],
                  external_ids: { isrc: "ZZZ" },
                },
              },
              { track: null }, // a removed / local file
            ],
          });
        if (url.includes("api.spotify.com/v1/playlists"))
          return json({ name: "Spot", images: [{ url: "c.jpg" }] });
        if (url.includes("/track/isrc:AAA"))
          return json(dzTrack(11, "A", "One"));
        if (url.includes("/track/isrc:ZZZ"))
          return json({ error: { type: "DataException", message: "no data" } });
        if (url.includes("/search")) {
          // Only "Two" should ever reach the fuzzy fallback with a hit.
          if (url.includes("Two"))
            return json({ data: [dzTrack(22, "B", "Two")] });
          return json({ data: [] });
        }
        throw new Error(`unstubbed fetch: ${url}`);
      }),
    );

    const out = await resolvePlaylist(parsePlaylistURL("spotify:playlist:abc"));
    expect(out.name).toBe("Spot");
    expect(out.tracks).toEqual([
      expect.objectContaining({ deezerId: 11, matchVia: "isrc", title: "One" }),
      expect.objectContaining({
        deezerId: 22,
        matchVia: "search",
        title: "Two",
      }),
    ]);
    // "Ghost" had no Deezer counterpart; the null item never became a track.
    expect(out.unavailable).toBe(1);
  });

  it("surfaces missing credentials as SpotifyNotConfigured", async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    delete process.env.SPOTIFY_CLIENT_SECRET;
    await expect(
      resolvePlaylist(parsePlaylistURL("spotify:playlist:abc")),
    ).rejects.toThrow(/spotify not configured/);
  });
});
