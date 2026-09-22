import { createApiClient } from "@frediverse/api-client";
import { authOrigin } from "@studio/web-protocol/services";
import type {
  Annotation,
  Envelope,
  EventsResult,
  LrcCandidate,
  Marker,
  Moment,
  Page,
  Release,
  Session,
  SingingExercise,
  Song,
  SongEnvelope,
  SupernoteSync,
  User,
} from "./types";

// Vite's `base`, minus its trailing slash, declared in vite.config.ts — see ../../docs/routing.md.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const client = createApiClient({ basePath: BASE });

// Every call sends the session cookie: createApiClient defaults to credentials "include".
const f = (path: string, init?: RequestInit) => client.raw(path, init);

const json = async (res: Response) => {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

export const api = {
  // --- Auth ---

  // A GETTER, and `return_to` is the name the OIDC package reads — ../../docs/routing.md.
  // Absolute, both the login URL and return_to: on k7's own subdomain, the
  // account flow lives at the family root (authOrigin), a DIFFERENT origin —
  // and return_to has to survive that round trip back to THIS one.
  get loginUrl(): string {
    const origin = window.location.origin;
    const here = origin + window.location.pathname + window.location.search;
    return `${authOrigin(origin)}/auth/login?return_to=${encodeURIComponent(here)}`;
  },

  // Absolute + credentials: "include" — same reason as loginUrl: /auth/*
  // only exists at the family root, a DIFFERENT origin from k7's own
  // subdomain, and a cross-origin fetch doesn't send cookies without this.
  getMe: async (): Promise<User | null> => {
    const res = await fetch(`${authOrigin(window.location.origin)}/auth/me`, {
      credentials: "include",
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()).user;
  },

  logout: (): Promise<unknown> =>
    fetch(`${authOrigin(window.location.origin)}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).then(json),

  // --- Sessions ---
  listSessions: (): Promise<Session[]> => f("/api/sessions").then(json),

  getSession: (id: string): Promise<Session> =>
    f(`/api/sessions/${id}`).then(json),

  createSession: (): Promise<Session> =>
    f("/api/sessions", { method: "POST" }).then(json),

  deleteSession: (id: string): Promise<null> =>
    f(`/api/sessions/${id}`, { method: "DELETE" }).then(json),

  uploadRecording: (
    id: string,
    blob: Blob,
    envelope: Envelope,
    duration: number,
    gain: number,
  ): Promise<Session> => {
    const form = new FormData();
    form.append("audio", blob, "recording.webm");
    form.append("envelope", JSON.stringify(envelope));
    form.append("duration", String(duration));
    form.append("gain", String(gain));
    return f(`/api/sessions/${id}/recording`, {
      method: "POST",
      body: form,
    }).then(json);
  },

  // Continue a saved session: the server glues the new take onto the existing recording.
  appendRecording: (
    id: string,
    blob: Blob,
    envelope: Envelope,
    duration: number,
    gain: number,
  ): Promise<Session> => {
    const form = new FormData();
    form.append("audio", blob, "recording.webm");
    form.append("envelope", JSON.stringify(envelope));
    form.append("duration", String(duration));
    form.append("gain", String(gain));
    form.append("append", "true");
    return f(`/api/sessions/${id}/recording`, {
      method: "POST",
      body: form,
    }).then(json);
  },

  getEnvelope: (id: string): Promise<Envelope> =>
    f(`/api/sessions/${id}/envelope`).then(json),

  getEvents: (
    id: string,
    threshold?: number,
    minSilenceSec?: number,
  ): Promise<EventsResult> => {
    const params = new URLSearchParams();
    if (threshold != null) params.set("threshold", String(threshold));
    if (minSilenceSec != null)
      params.set("minSilenceSec", String(minSilenceSec));
    return f(`/api/sessions/${id}/events?${params}`).then(json);
  },

  // Every *Url helper below spells BASE out, because the BROWSER fetches it — ../../docs/routing.md.
  recordingUrl: (id: string) => `${BASE}/api/sessions/${id}/recording`,

  addAnnotation: (
    id: string,
    ann: { startSec: number; endSec: number; text: string; tags?: string[] },
  ): Promise<Annotation> =>
    f(`/api/sessions/${id}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ann),
    }).then(json),

  updateAnnotation: (
    id: string,
    annId: string,
    patch: Partial<Annotation>,
  ): Promise<Annotation> =>
    f(`/api/sessions/${id}/annotations/${annId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  deleteAnnotation: (id: string, annId: string): Promise<null> =>
    f(`/api/sessions/${id}/annotations/${annId}`, {
      method: "DELETE",
    }).then(json),

  validateMoment: (id: string, annId: string): Promise<Annotation> =>
    f(`/api/sessions/${id}/annotations/${annId}/validate`, {
      method: "POST",
    }).then(json),

  momentClipUrl: (id: string, annId: string) =>
    `${BASE}/api/sessions/${id}/annotations/${annId}/clip`,

  // --- Markers (single-timestamp pins) ---
  addMarker: (
    id: string,
    marker: { atSec: number; comment?: string },
  ): Promise<Marker> =>
    f(`/api/sessions/${id}/markers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(marker),
    }).then(json),

  updateMarker: (
    id: string,
    markerId: string,
    patch: Partial<Pick<Marker, "atSec" | "comment">>,
  ): Promise<Marker> =>
    f(`/api/sessions/${id}/markers/${markerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  deleteMarker: (id: string, markerId: string): Promise<null> =>
    f(`/api/sessions/${id}/markers/${markerId}`, {
      method: "DELETE",
    }).then(json),

  // --- Moments (standalone) ---
  listMoments: (): Promise<Moment[]> => f("/api/moments").then(json),

  getMoment: (id: string): Promise<Moment> =>
    f(`/api/moments/${id}`).then(json),

  deleteMoment: (id: string): Promise<null> =>
    f(`/api/moments/${id}`, { method: "DELETE" }).then(json),

  momentPageClipUrl: (id: string) => `${BASE}/api/moments/${id}/clip`,

  addMomentMarker: (
    momentId: string,
    marker: { atSec: number; comment?: string },
  ): Promise<Marker> =>
    f(`/api/moments/${momentId}/markers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(marker),
    }).then(json),

  updateMomentMarker: (
    momentId: string,
    markerId: string,
    comment: string,
  ): Promise<Marker> =>
    f(`/api/moments/${momentId}/markers/${markerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    }).then(json),

  deleteMomentMarker: (momentId: string, markerId: string): Promise<null> =>
    f(`/api/moments/${momentId}/markers/${markerId}`, {
      method: "DELETE",
    }).then(json),

  // --- Releases ---
  listReleases: (): Promise<Release[]> => f("/api/releases").then(json),

  getRelease: (id: string): Promise<Release> =>
    f(`/api/releases/${id}`).then(json),

  createRelease: (data: {
    title: string;
    artist: string;
    releaseDate: string;
    description: string;
    canDownload: boolean;
    versionName: string;
    audio: File;
  }): Promise<Release> => {
    const form = new FormData();
    form.append("title", data.title);
    form.append("artist", data.artist);
    if (data.releaseDate) form.append("releaseDate", data.releaseDate);
    form.append("description", data.description);
    form.append("canDownload", String(data.canDownload));
    form.append("versionName", data.versionName);
    form.append("audio", data.audio, data.audio.name);
    return f("/api/releases", { method: "POST", body: form }).then(json);
  },

  deleteRelease: (id: string): Promise<null> =>
    f(`/api/releases/${id}`, { method: "DELETE" }).then(json),

  addVersion: (
    id: string,
    data: { name: string; isDefault: boolean; audio: File },
  ): Promise<unknown> => {
    const form = new FormData();
    form.append("name", data.name);
    form.append("isDefault", String(data.isDefault));
    form.append("audio", data.audio, data.audio.name);
    return f(`/api/releases/${id}/versions`, {
      method: "POST",
      body: form,
    }).then(json);
  },

  /** A version's shape, measured by the backend the first time and kept. */
  getVersionEnvelope: (id: string, versionId: string): Promise<SongEnvelope> =>
    f(`/api/releases/${id}/versions/${versionId}/envelope`).then(json),

  /** Swap a version's file, keeping its name, its stems and its place in the release. */
  replaceVersionAudio: (
    id: string,
    versionId: string,
    audio: File,
  ): Promise<unknown> => {
    const form = new FormData();
    form.append("audio", audio, audio.name);
    return f(`/api/releases/${id}/versions/${versionId}/audio`, {
      method: "PUT",
      body: form,
    }).then(json);
  },

  setDefaultVersion: (id: string, versionId: string): Promise<Release> =>
    f(`/api/releases/${id}/versions/${versionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    }).then(json),

  deleteVersion: (id: string, versionId: string): Promise<null> =>
    f(`/api/releases/${id}/versions/${versionId}`, {
      method: "DELETE",
    }).then(json),

  versionAudioUrl: (id: string, versionId: string) =>
    `${BASE}/api/releases/${id}/versions/${versionId}/audio`,

  // One stem of a multitrack version (download / stream).
  versionTrackUrl: (id: string, versionId: string, trackId: string) =>
    `${BASE}/api/releases/${id}/versions/${versionId}/tracks/${trackId}`,

  // Mint a personal access token for the st0 CLI (Settings UI).
  getApiToken: (): Promise<{ token: string }> => f("/api/token").then(json),

  // --- Pages ---
  listPages: (): Promise<Page[]> => f("/api/pages").then(json),

  getPage: (id: string): Promise<Page> => f(`/api/pages/${id}`).then(json),

  createPage: (data: {
    nametag: string;
    releaseIds: string[];
  }): Promise<Page> =>
    f("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updatePage: (
    id: string,
    patch: { nametag?: string; releaseIds?: string[] },
  ): Promise<Page> =>
    f(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  deletePage: (id: string): Promise<null> =>
    f(`/api/pages/${id}`, { method: "DELETE" }).then(json),

  // The address handed to someone else, so it must carry the origin, not just BASE.
  pagePublicUrl: (nametag: string): string =>
    `${window.location.origin}${BASE}/@${nametag}`,

  // No session on this one: the nametag is the whole address — ../../docs/ownership.md.
  getPublicPage: (nametag: string): Promise<Page> =>
    fetch(`${BASE}/api/public/pages/${nametag}`).then(json),

  publicVersionAudioUrl: (
    nametag: string,
    releaseId: string,
    versionId: string,
  ) =>
    `${BASE}/api/public/pages/${nametag}/releases/${releaseId}/versions/${versionId}/audio`,

  // --- Singing exercises (a personal practice book) ---
  listSingingExercises: (): Promise<SingingExercise[]> =>
    f("/api/singing").then(json),

  createSingingExercise: (data: {
    title: string;
    description: string;
    videoUrl: string;
  }): Promise<SingingExercise> =>
    f("/api/singing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updateSingingExercise: (
    id: string,
    patch: { title?: string; description?: string; videoUrl?: string },
  ): Promise<SingingExercise> =>
    f(`/api/singing/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  deleteSingingExercise: (id: string): Promise<null> =>
    f(`/api/singing/${id}`, { method: "DELETE" }).then(json),

  // --- Songs (songbook) ---
  listSongs: (): Promise<Song[]> => f("/api/songs").then(json),

  getSong: (id: string): Promise<Song> => f(`/api/songs/${id}`).then(json),

  createSong: (data: { artist: string; title: string }): Promise<Song> =>
    f("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updateSong: (
    id: string,
    patch: Partial<
      Pick<Song, "artist" | "title" | "lyrics" | "tablature" | "lyricTimings">
    >,
  ): Promise<Song> =>
    f(`/api/songs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  // Timed lyrics for a song on LRCLIB, asked through the backend; the track's length ranks them.
  searchLrclib: (id: string, duration?: number): Promise<LrcCandidate[]> =>
    f(
      `/api/songs/${id}/lrclib${duration ? `?duration=${Math.round(duration)}` : ""}`,
    ).then(json),

  // "Fetch song": a library master copied in as the track, and an instrumental mixed from its stems.
  copyLibraryTrack: (id: string, path: string): Promise<Song> =>
    f(`/api/songs/${id}/audio/from-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).then(json),

  mixInstrumental: (id: string, folder: string): Promise<Song> =>
    f(`/api/songs/${id}/instrumental/from-library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    }).then(json),

  songInstrumentalUrl: (id: string): string =>
    `${BASE}/api/songs/${id}/instrumental`,

  // A star is the connected user's own, so it has its own route rather than a song field.
  setSongFavorite: (id: string, favorite: boolean): Promise<Song> =>
    f(`/api/songs/${id}/favorite`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    }).then(json),

  // --- Supernote sync (the private cloud is the user's own) ---

  supernoteStatus: (): Promise<SupernoteSync> => f("/api/supernote").then(json),

  activateSupernote: (input: {
    baseUrl: string;
    account: string;
    password: string;
  }): Promise<SupernoteSync> =>
    f("/api/supernote", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).then(json),

  disableSupernote: (): Promise<SupernoteSync> =>
    f("/api/supernote", { method: "DELETE" }).then(json),

  syncSupernote: (): Promise<SupernoteSync> =>
    f("/api/supernote/sync", { method: "POST" }).then(json),

  // --- Remote microphone signaling ---

  // A short-lived ticket to open the /rtc signaling socket with.
  rtcTicket: (): Promise<{ ticket: string }> => f("/api/rtc/ticket").then(json),
  // Whether a device is currently connected at /remote (offering its mic).
  rtcRemoteStatus: (): Promise<{ connected: boolean }> =>
    f("/api/rtc/remote").then(json),

  deleteSong: (id: string): Promise<null> =>
    f(`/api/songs/${id}`, { method: "DELETE" }).then(json),

  // Sheet files (PDF / images): multipart with a repeated "files" field, answering the song.
  uploadSheetFiles: (id: string, files: File[]): Promise<Song> => {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    return f(`/api/songs/${id}/sheets`, { method: "POST", body }).then(json);
  },

  deleteSheetFile: (id: string, fileId: string): Promise<Song> =>
    f(`/api/songs/${id}/sheets/${fileId}`, { method: "DELETE" }).then(json),

  // The reference track: one per song, multipart under the field "audio".
  uploadSongAudio: (id: string, file: File): Promise<Song> => {
    const body = new FormData();
    body.append("audio", file);
    return f(`/api/songs/${id}/audio`, { method: "POST", body }).then(json);
  },

  deleteSongAudio: (id: string): Promise<Song> =>
    f(`/api/songs/${id}/audio`, { method: "DELETE" }).then(json),

  /** The track's shape; the backend measures it the first time and keeps it. */
  getSongEnvelope: (id: string): Promise<SongEnvelope> =>
    f(`/api/songs/${id}/envelope`).then(json),

  songAudioUrl: (id: string) => `${BASE}/api/songs/${id}/audio`,

  // `name` is decoration the EPUB export needs: the media type is read off the extension.
  sheetFileUrl: (id: string, fileId: string, name?: string) =>
    `${BASE}/api/songs/${id}/sheets/${fileId}${
      name ? `/${encodeURIComponent(name)}` : ""
    }`,
};
