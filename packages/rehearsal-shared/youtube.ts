// A demo link on an exercise is a YOUTUBE link, and this is what says so. Checked on both sides:
// the form for an instant refusal, the route because a client is never trusted.

/** The hosts a YouTube watch link actually arrives under, short and mobile forms included. */
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

/** Is this a YouTube link? An empty string is not one, and that is a legitimate state. */
export function isYouTubeUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    const url = new URL(value.trim());
    // http(s) only: a `javascript:` URL in an href is the reason this checks the protocol.
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false; // not a URL at all
  }
}
