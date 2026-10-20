// updateCheck.ts — whether the build k7.rocks/app_downloads serves is newer than the running stamp, and when to ask again.
// A tagged build follows the `release` channel, a snapshot the `snapshot` one. Pure, so it is tested. See docs/appUpdates.md.

import { isNewerTag, parseStamp, releaseLabel } from "./release.ts";

/** Where desktop.yml and tray.yml publish every build; `K7_DOWNLOADS_URL` overrides it. Also each electron-builder.cjs's feed. */
export const DOWNLOADS = "https://k7.rocks/app_downloads";

/** The apps /app_downloads keeps a feed for: the desktop app's at its root, the tray's under `tray/`. */
export type Product = "desktop" | "tray";

/** The folder `product`'s channels live in, under the downloads page `downloads`. */
export const productBase = (product: Product, downloads = DOWNLOADS): string =>
  product === "desktop" ? downloads : `${downloads}/${product}`;

/** How often an automatic check runs at most. */
const CHECK_EVERY_MS = 6 * 3600_000;

export type Channel = "release" | "snapshot";

/** The fields of `<channel>.json` read here. */
export interface PublishedBuild {
  stamp?: unknown;
}

/** A newer build: what the notice names, its stamp, and the page its Download button opens. */
export interface Available {
  name: string;
  stamp: string;
  url: string;
}

/** The channel `stamp` follows, or null when it has none (a checkout run). */
export function channelOf(stamp: string): Channel | null {
  const s = parseStamp(stamp);
  return s ? s.kind : null;
}

/** What to ask for `stamp`'s channel, or null for a checkout run. */
export function buildUrl(stamp: string, base = DOWNLOADS): string | null {
  const channel = channelOf(stamp);
  return channel ? `${base}/${channel}.json` : null;
}

/** The folder electron-updater reads latest*.yml from, for `stamp`'s channel. */
export function feedUrl(stamp: string, base = DOWNLOADS): string | null {
  const channel = channelOf(stamp);
  return channel ? `${base}/${channel}` : null;
}

/** The newer build `b` is, compared with `stamp`; null when it is the same one, older, or unreadable. `page` is what Download opens. */
export function newerBuild(
  stamp: string,
  b: PublishedBuild,
  page = DOWNLOADS,
): Available | null {
  const s = parseStamp(stamp);
  const other = typeof b.stamp === "string" ? b.stamp : "";
  if (!s || parseStamp(other)?.kind !== s.kind) return null;
  // The snapshot channel only ever holds main's latest build, so another commit is a later one.
  const newer =
    s.kind === "release" ? isNewerTag(stamp, other) : other !== stamp;
  return newer ? { name: releaseLabel(other), stamp: other, url: page } : null;
}

/** Whether an automatic check is due, given the last one's time. */
export const checkDue = (last: number | undefined, now: number): boolean =>
  !last || now - last >= CHECK_EVERY_MS || now < last;
