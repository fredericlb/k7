// sessions.ts — a session's calls: its take, its envelope, its moments as annotations, its markers.

import { apiBase } from "../config";
import type { Annotation, Envelope, Marker, Session } from "../types";
import { f, json } from "./http";

export const sessionsApi = {
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

  // Every *Url helper below spells the base out, because the BROWSER fetches it — ../../docs/routing.md.
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
};
