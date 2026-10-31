// pairConsent.ts — the page a server shows before it mints a device token: for ANOTHER server always (a token sent to
// an https return is sent to whoever wrote the link), and for a machine when the account is a choice — the person adds
// another, or the browser is signed in as someone else than k7 expects. It names the account the token is for and
// offers another one. The click is a same-origin POST, which a link on another site cannot forge. See docs/syncRelay.md.

import type { Request } from "express";
import { publicHost } from "./publicOrigin.ts";

const html = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Who asks: another server by its host, or a machine by the name it gave. */
export type Asker = { server: string } | { device: string };

/** The confirmation: `fields` ride back unchanged in the form, `email` is the account signed in here. */
export function consentPage(
  asker: Asker,
  email: string,
  fields: Record<string, string>,
  canSwitch: boolean,
): string {
  const hidden = Object.entries(fields)
    .map(
      ([k, v]) => `<input type="hidden" name="${html(k)}" value="${html(v)}">`,
    )
    .join("");
  const button = "font:inherit;padding:6px 14px";
  const head =
    "server" in asker
      ? `<h1 style="font-size:20px">Sync with ${html(asker.server)}?</h1>
<p>The k7 server <b>${html(asker.server)}</b> asks to sync with your account <b>${html(email)}</b> here.</p>
<p>Allowed, it can read and change every workspace of this account on this server. Allow it only if you added ${html(asker.server)} yourself, just now.</p>`
      : `<h1 style="font-size:20px">Link ${html(asker.device)} to ${html(email)}?</h1>
<p>k7 on <b>${html(asker.device)}</b> asks to sync with the account <b>${html(email)}</b> on this server.</p>
<p>Allowed, it can read and change every workspace of this account here.</p>`;
  // Signed out here and back in, the browser returns to this same page, which then names the account chosen.
  const other = canSwitch
    ? `<form method="post" style="margin-top:16px">${hidden}<input type="hidden" name="switch" value="1">
<button type="submit" style="${button}">Use another account</button></form>`
    : "";
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>k7</title>
<body style="font:16px system-ui;background:#101114;color:#e4e4e7;padding:24px;max-width:36em">
${head}
<form method="post">${hidden}<input type="hidden" name="confirm" value="1">
<button type="submit" style="${button}">Allow as ${html(email)}</button>
<a href="/" style="color:#a1a1aa;margin-left:12px">Cancel</a></form>${other}`;
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
