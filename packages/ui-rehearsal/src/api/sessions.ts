// sessions.ts — a session's calls: its take and its envelope. Its moments and markers are its recording's (moments.ts).

import { apiBase } from "../config";
import type { Envelope, Session } from "../types";
import { f, fu, json, type OnProgress } from "./http";

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
    onProgress?: OnProgress,
  ): Promise<Session> => {
    const form = new FormData();
    form.append("audio", blob, "recording.webm");
    form.append("envelope", JSON.stringify(envelope));
    form.append("duration", String(duration));
    form.append("gain", String(gain));
    return fu(`/api/sessions/${id}/recording`, "POST", form, onProgress).then(
      json,
    );
  },

  // Continue a saved session: the server glues the new take onto the existing recording.
  appendRecording: (
    id: string,
    blob: Blob,
    envelope: Envelope,
    duration: number,
    gain: number,
    onProgress?: OnProgress,
  ): Promise<Session> => {
    const form = new FormData();
    form.append("audio", blob, "recording.webm");
    form.append("envelope", JSON.stringify(envelope));
    form.append("duration", String(duration));
    form.append("gain", String(gain));
    form.append("append", "true");
    return fu(`/api/sessions/${id}/recording`, "POST", form, onProgress).then(
      json,
    );
  },

  getEnvelope: (id: string): Promise<Envelope> =>
    f(`/api/sessions/${id}/envelope`).then(json),

  // Every *Url helper below spells the base out, because the BROWSER fetches it — ../../docs/routing.md.
  recordingUrl: (id: string) => `${apiBase()}/api/sessions/${id}/recording`,
};
