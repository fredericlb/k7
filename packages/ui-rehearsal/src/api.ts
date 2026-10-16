import { apiBase, pagesPrefix } from "./config";
import type {
  Annotation,
  Envelope,
  EventsResult,
  FetchStatus,
  LrcCandidate,
  Marker,
  Moment,
  MomentPlacement,
  Page,
  PageVisibility,
  PublicationsStatus,
  Release,
  ReleasePatch,
  Session,
  SingingExercise,
  Song,
  SongbookPlacement,
  SongEnvelope,
  SongListEntry,
} from "./types";

/** A publish token as its owner sees it: never the token itself. */
export interface ApiToken {
  id: string;
  label: string;
  created: number;
  expires: number;
  lastUsed: number | null;
}

// Every call sends the session cookie, under the base the host configured (config.ts).
const f = (path: string, init?: RequestInit) =>
  fetch(`${apiBase()}${path}`, { credentials: "include", ...init });

const json = async (res: Response) => {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};

/** A page open to anyone signed in, asked for without a session: signing in may still open it. */
export class UnauthenticatedError extends Error {}

export const api = {
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

  // Every *Url helper below spells the base out, because the BROWSER fetches it — ../docs/routing.md.
  recordingUrl: (id: string) => `${apiBase()}/api/sessions/${id}/recording`,

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
    `${apiBase()}/api/sessions/${id}/annotations/${annId}/clip`,

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
  /** Which moments the paired server holds a copy of — ../../rehearsal-server/docs/momentShare.md. */
  momentPlacement: (): Promise<MomentPlacement> =>
    f("/api/sync/moments-share").then(json),
  /** Share one moment with the paired server, replacing its copy; the session stays here. */
  shareMoment: (id: string): Promise<unknown> =>
    f(`/api/sync/moments-share/${encodeURIComponent(id)}/share`, {
      method: "POST",
    }).then(json),

  getMoment: (id: string): Promise<Moment> =>
    f(`/api/moments/${id}`).then(json),

  deleteMoment: (id: string): Promise<null> =>
    f(`/api/moments/${id}`, { method: "DELETE" }).then(json),

  momentPageClipUrl: (id: string) => `${apiBase()}/api/moments/${id}/clip`,

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

  updateRelease: (id: string, patch: ReleasePatch): Promise<Release> =>
    f(`/api/releases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

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

  /** A hidden version stays in the release and leaves every page's dropdown. */
  setVersionHidden: (
    id: string,
    versionId: string,
    hidden: boolean,
  ): Promise<Release> =>
    f(`/api/releases/${id}/versions/${versionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    }).then(json),

  deleteVersion: (id: string, versionId: string): Promise<null> =>
    f(`/api/releases/${id}/versions/${versionId}`, {
      method: "DELETE",
    }).then(json),

  versionAudioUrl: (id: string, versionId: string) =>
    `${apiBase()}/api/releases/${id}/versions/${versionId}/audio`,

  // The audio as an attachment, named after the release and the version.
  versionDownloadUrl: (id: string, versionId: string) =>
    `${apiBase()}/api/releases/${id}/versions/${versionId}/download`,

  // One stem of a multitrack version (download / stream).
  versionTrackUrl: (id: string, versionId: string, trackId: string) =>
    `${apiBase()}/api/releases/${id}/versions/${versionId}/tracks/${trackId}`,

  // Mint a personal access token for the k7 CLI (Settings UI): a POST, never a GET.
  createApiToken: (label?: string): Promise<{ token: string } & ApiToken> =>
    f("/api/token/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    }).then(json),

  listApiTokens: (): Promise<{ tokens: ApiToken[] }> =>
    f("/api/token/publish").then(json),

  revokeApiToken: (id: string): Promise<{ ok: true }> =>
    f(`/api/token/publish/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(json),

  // --- Pages ---
  listPages: (): Promise<Page[]> => f("/api/pages").then(json),

  getPage: (id: string): Promise<Page> => f(`/api/pages/${id}`).then(json),

  createPage: (data: {
    nametag: string;
    releaseIds: string[];
    visibility: PageVisibility;
  }): Promise<Page> =>
    f("/api/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updatePage: (
    id: string,
    patch: {
      nametag?: string;
      releaseIds?: string[];
      versionIds?: Record<string, string>;
      visibility?: PageVisibility;
    },
  ): Promise<Page> =>
    f(`/api/pages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  deletePage: (id: string): Promise<null> =>
    f(`/api/pages/${id}`, { method: "DELETE" }).then(json),

  // The address handed to someone else, so it must carry the origin and the pages' prefix.
  pagePublicUrl: (nametag: string): string =>
    `${window.location.origin}${pagesPrefix()}/@${nametag}`,

  // No session needed, but one is sent: the page's visibility is graded against it — ../../rehearsal-server/docs/pages.md.
  getPublicPage: async (nametag: string): Promise<Page> => {
    const res = await f(`/api/public/pages/${encodeURIComponent(nametag)}`);
    if (res.status === 401) throw new UnauthenticatedError();
    return json(res);
  },

  /** Signing in, then coming back to the address this tab is on; `return_to` is what the OIDC flow reads. */
  get loginUrl(): string {
    const here = window.location.pathname + window.location.search;
    return `${apiBase()}/auth/login?return_to=${encodeURIComponent(here)}`;
  },

  publicVersionAudioUrl: (
    nametag: string,
    releaseId: string,
    versionId: string,
  ) =>
    `${apiBase()}/api/public/pages/${encodeURIComponent(nametag)}/releases/${releaseId}/versions/${versionId}/audio`,

  // Answers 404 unless the release allows downloads.
  publicVersionDownloadUrl: (
    nametag: string,
    releaseId: string,
    versionId: string,
  ) =>
    `${apiBase()}/api/public/pages/${encodeURIComponent(nametag)}/releases/${releaseId}/versions/${versionId}/download`,

  getPublicVersionEnvelope: (
    nametag: string,
    releaseId: string,
    versionId: string,
  ): Promise<SongEnvelope> =>
    fetch(
      `${apiBase()}/api/public/pages/${encodeURIComponent(nametag)}/releases/${releaseId}/versions/${versionId}/envelope`,
    ).then(json),

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
  /** The songbook's rows, without any song's texts: a song's own GET has them. */
  listSongs: (): Promise<SongListEntry[]> => f("/api/songs").then(json),
  /** Whether releases and pages can be reached: they live on the server alone — ../../rehearsal-server/docs/publications.md. */
  publicationsStatus: (): Promise<PublicationsStatus> =>
    f("/api/publications").then(json),
  /** Where each song lives on a machine paired with a server — ../../rehearsal-server/docs/songbookCopy.md. */
  songbookPlacement: (): Promise<SongbookPlacement> =>
    f("/api/sync/songbook-copy").then(json),
  /** Copy one server-only song here, its sheets and track with it. */
  downloadSong: (id: string): Promise<unknown> =>
    f("/api/sync/songbook-copy/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).then(json),

  getSong: (id: string): Promise<Song> => f(`/api/songs/${id}`).then(json),

  createSong: (data: {
    artist: string;
    title: string;
    private: boolean;
  }): Promise<Song> =>
    f("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then(json),

  updateSong: (
    id: string,
    patch: Partial<
      Pick<
        Song,
        | "artist"
        | "title"
        | "lyrics"
        | "tablature"
        | "lyricTimings"
        | "lyricsMatch"
        | "fetchIgnored"
      >
    > & { fetchStatus?: Partial<FetchStatus> },
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
  // The song forgets its library track and instrumental; pl8 keeps the files.
  unlinkSongAudio: (id: string): Promise<Song> =>
    f(`/api/songs/${id}/audio`, { method: "DELETE" }).then(json),

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

  // A star is the connected user's own, so it has its own route rather than a song field.
  setSongFavorite: (id: string, favorite: boolean): Promise<Song> =>
    f(`/api/songs/${id}/favorite`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite }),
    }).then(json),

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

  /** The track's shape; the backend measures it the first time and keeps it. */
  getSongEnvelope: (id: string): Promise<SongEnvelope> =>
    f(`/api/songs/${id}/envelope`).then(json),

  // `name` is decoration the EPUB export needs: the media type is read off the extension.
  sheetFileUrl: (id: string, fileId: string, name?: string) =>
    `${apiBase()}/api/songs/${id}/sheets/${fileId}${
      name ? `/${encodeURIComponent(name)}` : ""
    }`,
};
