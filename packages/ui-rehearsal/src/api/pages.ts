// pages.ts — a page's calls, and a public page's, read without a session.

import { apiBase, pagesPrefix } from "../config";
import type { Page, PageVisibility, SongEnvelope } from "../types";
import { f, json, UnauthenticatedError } from "./http";

export const pagesApi = {
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

  // No session needed, but one is sent: the page's visibility is graded against it — ../../../rehearsal-server/docs/pages.md.
  getPublicPage: async (nametag: string): Promise<Page> => {
    const res = await f(`/api/public/pages/${encodeURIComponent(nametag)}`);
    if (res.status === 401) throw new UnauthenticatedError();
    return json(res);
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
};

/** Signing in, then coming back to the address this tab is on; `return_to` is what the OIDC flow reads. */
export function loginUrl(): string {
  const here = window.location.pathname + window.location.search;
  return `${apiBase()}/auth/login?return_to=${encodeURIComponent(here)}`;
}
