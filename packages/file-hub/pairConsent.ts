// pairConsent.ts — the page a server shows before it mints a device token for ANOTHER server: a token sent to an https
// return is sent to whoever wrote the link, so the person names that server with a click on this origin's own page.
// The click is a same-origin POST, which a link on another site cannot forge. See docs/syncRelay.md.

import type { Request } from "express";
import { publicHost } from "./publicOrigin.ts";

const html = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** The confirmation: `fields` ride back unchanged in the form, `host` is the server asking, `email` the account. */
export function consentPage(
  host: string,
  email: string,
  fields: Record<string, string>,
): string {
  const hidden = Object.entries(fields)
    .map(
      ([k, v]) => `<input type="hidden" name="${html(k)}" value="${html(v)}">`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>k7</title>
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;padding:24px;max-width:36em">
<h1 style="font-size:20px">Sync with ${html(host)}?</h1>
<p>The k7 server <b>${html(host)}</b> asks to sync with your account <b>${html(email)}</b> here.</p>
<p>Allowed, it can read and change every workspace of this account on this server. Allow it only if you added ${html(host)} yourself, just now.</p>
<form method="post">${hidden}
<button type="submit" style="font:inherit;padding:6px 14px">Allow</button>
<a href="/" style="color:#a1a1aa;margin-left:12px">Cancel</a></form>`;
}

/** Whether `req` is a form this origin's own page posted: the browser says so, and another site cannot make it lie. */
export function sameOriginPost(req: Request): boolean {
  const site = req.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === publicHost(req);
  } catch {
    return false;
  }
}
