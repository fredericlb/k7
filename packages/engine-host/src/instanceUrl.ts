// instanceUrl.ts — what the user typed as an st0 instance, reduced to a bare origin, strictly: a
// typo fails visibly rather than being turned into some other address. The registry behind it is
// then ASKED before anything is written (supervisor.ts). See docs/supervisorPolicy.md.

// Node's `URL` is not enough on its own: `*` is a legal host code point, and `.origin` silently DISCARDS credentials.

// The strict core. `url` must already carry a scheme.
function originOf(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Rejected, not dropped — see the note above.
  if (url.username !== "" || url.password !== "") return null;
  if (!url.hostname || url.hostname.includes("*")) return null;
  // For http/https this is the origin exactly as a browser sends it; other schemes serialise "null".
  const origin = url.origin;
  if (!origin || origin === "null") return null;
  return origin;
}

/** Reduce whatever the USER typed to a bare origin, strictly, so a typo fails visibly; a bare host is given `https://` rather than refused. */
export function normaliseUserOrigin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = raw.includes("://") ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  return originOf(url);
}
