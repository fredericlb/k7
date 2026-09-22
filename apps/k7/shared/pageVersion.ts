// Which versions of a release a page offers, and which one it plays first. Shared: the page
// editor shows it and the public route serves it, and two answers would mean the link plays
// what the owner never picked. See ../docs/pages.md.

import type { Page, Release, ReleaseVersion } from "./types.ts";

/** The page's choice if it still exists and is not hidden, the release's default otherwise. */
export function pageVersion(
  page: Pick<Page, "versionIds">,
  release: Release,
): ReleaseVersion | null {
  const versions = release.versions ?? [];
  const choice = page.versionIds?.[release.id];
  const chosen = versions.find((v) => v.id === choice && !v.hidden);
  return (
    chosen ?? versions.find((v) => v.id === release.defaultVersionId) ?? null
  );
}

/** What a visitor may pick: every version not hidden, plus the one the page plays even if it is. */
export function pageChoices(
  page: Pick<Page, "versionIds">,
  release: Release,
): ReleaseVersion[] {
  const played = pageVersion(page, release);
  return (release.versions ?? []).filter(
    (v) => !v.hidden || v.id === played?.id,
  );
}
