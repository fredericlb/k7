// moments.ts — a moment's calls: made on a recording by its path, then standing alone with its clip,
// its markers, its share to a server. A recording is any capture, a session's included (../../docs/recordings.md).

import { apiBase } from "../config";
import type {
  Annotation,
  Envelope,
  Marker,
  Moment,
  MomentPlacement,
  RecordingMoments,
} from "../types";
import { f, json } from "./http";

// The recorder's own ceiling on a take's playback gain.
const MAX_GAIN = 32;

export const momentsApi = {
  // --- Moments (standalone) ---
  listMoments: (): Promise<Moment[]> => f("/api/moments").then(json),
  /** Which moments the paired server holds a copy of — ../../../rehearsal-server/docs/momentShare.md. */
  momentPlacement: (): Promise<MomentPlacement> =>
    f("/api/sync/moments-share").then(json),
  /** Share one moment with the paired server, replacing its copy; the session stays here. */
  shareMoment: (id: string): Promise<unknown> =>
    f(`/api/sync/moments-share/${encodeURIComponent(id)}/share`, {
      method: "POST",
    }).then(json),

  /** A recording's page: its start, the session that saved it if one did, and its moments. */
  recordingMoments: (path: string): Promise<RecordingMoments> =>
    f(`/api/moments/recording?path=${encodeURIComponent(path)}`).then(json),

  addMoment: (
    recordingPath: string,
    ann: { startSec: number; endSec: number; text: string; tags?: string[] },
  ): Promise<Annotation> =>
    f("/api/moments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingPath, ...ann }),
    }).then(json),

  updateMoment: (id: string, patch: Partial<Annotation>): Promise<Annotation> =>
    f(`/api/moments/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  /** Cut the moment's clip again, when the automatic cut could not. */
  validateMoment: (id: string): Promise<Annotation> =>
    f(`/api/moments/${id}/validate`, { method: "POST" }).then(json),

  /** A capture's audio, played straight from the médiathèque. */
  captureUrl: (path: string) =>
    `${apiBase()}/api/mediatek/stream?path=${encodeURIComponent(path)}`,

  /** A capture's shape as the médiathèque measures it, in a session's envelope, and the gain a take would have stored. */
  captureEnvelope: async (
    path: string,
  ): Promise<{ envelope: Envelope; duration: number; gain: number }> => {
    const raw = (await f(
      `/api/mediatek/envelope?path=${encodeURIComponent(path)}`,
    ).then(json)) as { seconds: number; rms: number[]; peak?: number[] };
    const n = Math.max(1, raw.rms.length);
    // The recorder's rule over the loudest bucket: 0.9 over the true peak, capped (packages/recorder/src/useRecorder.ts).
    const peak = (raw.peak ?? raw.rms).reduce((a, b) => (b > a ? b : a), 0);
    return {
      envelope: { intervalMs: (raw.seconds * 1000) / n, samples: raw.rms },
      duration: raw.seconds,
      gain: peak > 0 ? Math.min(MAX_GAIN, 0.9 / peak) : 1,
    };
  },

  // --- Markers: pins on a recording's timeline ---
  addRecordingMarker: (
    recordingPath: string,
    marker: { atSec: number; comment?: string },
  ): Promise<Marker> =>
    f("/api/moments/recording/markers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingPath, ...marker }),
    }).then(json),

  updateRecordingMarker: (
    markerId: string,
    patch: Partial<Pick<Marker, "atSec" | "comment">>,
  ): Promise<Marker> =>
    f(`/api/moments/recording/markers/${markerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then(json),

  deleteRecordingMarker: (markerId: string): Promise<null> =>
    f(`/api/moments/recording/markers/${markerId}`, {
      method: "DELETE",
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
};
