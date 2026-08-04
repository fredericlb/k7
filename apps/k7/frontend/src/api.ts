import { createApiClient } from "@frediverse/api-client";
import type {
  Annotation,
  Envelope,
  EventsResult,
  Marker,
  Moment,
  Page,
  Release,
  Session,
  Song,
  User,
} from "./types";

// Single-origin: the SPA is served at / and the backend at /api on the same
// host (nginx proxies it in the image, Vite proxies it in dev), so paths stay
// relative — there is no API origin to configure.
// The API moved under the service prefix; AUTH did not. studio.test is one origin
// and the l8 backend owns /auth/* at its root for every service, so those two
// calls below use a bare fetch rather than this client.
const client = createApiClient({ basePath: "/k7" });

// All API calls send the session cookie (createApiClient defaults to
// credentials: "include").
const f = (path: string, init?: RequestInit) => client.raw(path, init);

const json = async (res: Response) => {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

export const api = {
  // --- Auth ---
  loginUrl: `/auth/login`,

  getMe: async (): Promise<User | null> => {
    const res = await fetch("/auth/me");
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()).user;
  },

  logout: (): Promise<unknown> =>
    fetch("/auth/logout", { method: "POST" }).then(json),

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

  // Continue a saved session — the new take is concatenated onto the existing
  // recording server-side.
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

  recordingUrl: (id: string) => `/api/sessions/${id}/recording`,

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
    `/api/sessions/${id}/annotations/${annId}/clip`,

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

  momentPageClipUrl: (id: string) => `/api/moments/${id}/clip`,

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
    `/api/releases/${id}/versions/${versionId}/audio`,

  // One stem of a multitrack version (download / stream).
  versionTrackUrl: (id: string, versionId: string, trackId: string) =>
    `/api/releases/${id}/versions/${versionId}/tracks/${trackId}`,

  // Mint a personal access token for the l8 CLI (Settings UI).
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
      Pick<Song, "artist" | "title" | "lyrics" | "tablature" | "favorite">
    >,
  ): Promise<Song> =>
    f(`/api/songs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  // --- Remote microphone signaling ---
  // A short-lived ticket to open the /rtc signaling socket with.
  rtcTicket: (): Promise<{ ticket: string }> => f("/api/rtc/ticket").then(json),
  // Whether a device is currently connected at /remote (offering its mic).
  rtcRemoteStatus: (): Promise<{ connected: boolean }> =>
    f("/api/rtc/remote").then(json),

  deleteSong: (id: string): Promise<null> =>
    f(`/api/songs/${id}`, { method: "DELETE" }).then(json),

  // Sheet files (PDF / images). Upload sends multipart with a repeated "files"
  // field; both upload and delete return the updated song.
  uploadSheetFiles: (id: string, files: File[]): Promise<Song> => {
    const body = new FormData();
    for (const file of files) body.append("files", file);
    return f(`/api/songs/${id}/sheets`, { method: "POST", body }).then(json);
  },

  deleteSheetFile: (id: string, fileId: string): Promise<Song> =>
    f(`/api/songs/${id}/sheets/${fileId}`, { method: "DELETE" }).then(json),

  sheetFileUrl: (id: string, fileId: string) =>
    `/api/songs/${id}/sheets/${fileId}`,
};
