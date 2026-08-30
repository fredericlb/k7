// remoteUrl.ts — the same address, on a base a SECOND DEVICE can open. Every href this page
// builds comes from `window.location.origin` (api.ts), which in the desktop window is
// 127.0.0.1: right for the window, and unreachable from the phone reading a QR code off it.
// The app knows the addresses that ARE reachable (`lanUrls`, apps/studio-desktop/docs/externals.md).
// See ../../docs/projects.md.

/** Loopback in the four spellings a browser puts in an origin; `.localhost` is reserved for it too. */
const LOOPBACK =
  /^https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|[^/]+\.localhost)(?::\d+)?$/;

/** Is this origin one only THIS machine can reach? Then nothing built on it belongs in a QR code. */
export function isLoopbackOrigin(origin: string): boolean {
  return LOOPBACK.test(origin);
}

/**
 * `url` rebased on somewhere a second device can reach, or **null** when there is nowhere: a
 * desktop window with no LAN address has nothing to offer, and saying so beats a QR code that
 * scans to a page the phone cannot load.
 */
export function remoteUrl(
  url: string,
  lanUrls: readonly string[],
  origin: string,
): string | null {
  // A public or LAN-proxied origin is already the answer — the hosted studio needs no rebasing.
  if (!isLoopbackOrigin(origin)) return url;
  const base = lanUrls[0];
  if (!base) return null;
  try {
    const u = new URL(url);
    return base.replace(/\/+$/, "") + u.pathname + u.search + u.hash;
  } catch {
    return null; // not a URL we can take apart, so not one to put on a screen
  }
}
