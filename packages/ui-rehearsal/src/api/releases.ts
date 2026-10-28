// releases.ts — a release's calls and its versions', and whether the paired server holds them.

import { apiBase } from "../config";
import type {
  PublicationsStatus,
  Release,
  ReleasePatch,
  SongEnvelope,
} from "../types";
import { f, fu, json, type OnProgress } from "./http";

export const releasesApi = {
  // --- Releases ---
  /** Whether releases and pages can be reached: they live on the server alone — ../../../rehearsal-server/docs/publications.md. */
  publicationsStatus: (): Promise<PublicationsStatus> =>
    f("/api/publications").then(json),

  listReleases: (): Promise<Release[]> => f("/api/releases").then(json),

  getRelease: (id: string): Promise<Release> =>
    f(`/api/releases/${id}`).then(json),

  updateRelease: (id: string, patch: ReleasePatch): Promise<Release> =>
    f(`/api/releases/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  createRelease: (
    data: {
      title: string;
      artist: string;
      releaseDate: string;
      description: string;
      canDownload: boolean;
      versionName: string;
      audio: File;
    },
    onProgress?: OnProgress,
  ): Promise<Release> => {
    const form = new FormData();
    form.append("title", data.title);
    form.append("artist", data.artist);
    if (data.releaseDate) form.append("releaseDate", data.releaseDate);
    form.append("description", data.description);
    form.append("canDownload", String(data.canDownload));
    form.append("versionName", data.versionName);
    form.append("audio", data.audio, data.audio.name);
    return fu("/api/releases", "POST", form, onProgress).then(json);
  },

  deleteRelease: (id: string): Promise<null> =>
    f(`/api/releases/${id}`, { method: "DELETE" }).then(json),

  addVersion: (
    id: string,
    data: { name: string; isDefault: boolean; audio: File },
    onProgress?: OnProgress,
  ): Promise<unknown> => {
    const form = new FormData();
    form.append("name", data.name);
    form.append("isDefault", String(data.isDefault));
    form.append("audio", data.audio, data.audio.name);
    return fu(`/api/releases/${id}/versions`, "POST", form, onProgress).then(
      json,
    );
  },

  /** A version's shape, measured by the backend the first time and kept. */
  getVersionEnvelope: (id: string, versionId: string): Promise<SongEnvelope> =>
    f(`/api/releases/${id}/versions/${versionId}/envelope`).then(json),

  /** Swap a version's file, keeping its name, its stems and its place in the release. */
  replaceVersionAudio: (
    id: string,
    versionId: string,
    audio: File,
    onProgress?: OnProgress,
  ): Promise<unknown> => {
    const form = new FormData();
    form.append("audio", audio, audio.name);
    return fu(
      `/api/releases/${id}/versions/${versionId}/audio`,
      "PUT",
      form,
      onProgress,
    ).then(json);
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
};
