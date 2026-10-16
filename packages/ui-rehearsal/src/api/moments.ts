// moments.ts — a moment's calls once it stands alone: its clip, its markers, its share to a server.

import { apiBase } from "../config";
import type { Marker, Moment, MomentPlacement } from "../types";
import { f, json } from "./http";

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
