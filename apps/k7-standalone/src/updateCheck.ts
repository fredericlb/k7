// updateCheck.ts — whether a GitHub release is newer than the running stamp, and when to ask again. Pure, so it is tested.
// A tagged build follows tagged releases; a snapshot follows the moving `snapshot` prerelease. See docs/notices.md.

import { isNewerTag, parseStamp } from "./release.ts";

/** The repository the desktop workflow publishes to; `K7_RELEASES_REPO` overrides it. */
export const RELEASES_REPO = "fredericlb/k7";

/** How often an automatic check runs at most. */
export const CHECK_EVERY_MS = 24 * 3600_000;

/** The fields of GitHub's release object read here. */
export interface GithubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  target_commitish?: unknown;
  name?: unknown;
}

/** A newer build: what the notice names, and the page its Download button opens. */
export interface Available {
  name: string;
  url: string;
}

/** The API address to ask for `stamp`'s channel, or null when it has none (a checkout run). */
export function releaseApiUrl(
  stamp: string,
  repo = RELEASES_REPO,
): string | null {
  const s = parseStamp(stamp);
  if (!s) return null;
  const base = `https://api.github.com/repos/${repo}/releases`;
  return s.kind === "release" ? `${base}/latest` : `${base}/tags/snapshot`;
}

/** Only a release page on github.com is opened: the answer came over the network. */
const pageOf = (r: GithubRelease): string | null =>
  typeof r.html_url === "string" && r.html_url.startsWith("https://github.com/")
    ? r.html_url
    : null;

/** The newer build `r` is, compared with `stamp`; null when it is the same one, older, or unreadable. */
export function newerRelease(
  stamp: string,
  r: GithubRelease,
): Available | null {
  const s = parseStamp(stamp);
  const url = pageOf(r);
  if (!s || !url) return null;
  if (s.kind === "release") {
    const tag = typeof r.tag_name === "string" ? r.tag_name : "";
    return isNewerTag(stamp, tag) ? { name: tag.slice(1), url } : null;
  }
  // The snapshot prerelease is recut on every main push, so another commit is a later one.
  const target =
    typeof r.target_commitish === "string" ? r.target_commitish : "";
  if (!/^[0-9a-f]{7,40}$/.test(target) || target.startsWith(s.commit))
    return null;
  return { name: `snapshot-${target.slice(0, 7)}`, url };
}

/** Whether an automatic check is due, given the last one's time. */
export const checkDue = (last: number | undefined, now: number): boolean =>
  !last || now - last >= CHECK_EVERY_MS || now < last;
