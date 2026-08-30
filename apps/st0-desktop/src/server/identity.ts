// identity.ts — who this machine's workspaces belong to. Offline there is no OIDC to ask, so
// it is REMEMBERED; it names the engine SESSION and the SSH key directory, and the frontend
// draws it. It no longer names a workspace directory — one machine holds one person's
// workspaces (packages/engine-client/docs/paths.md), which is what retired the hazard this
// file was written for. See ../../docs/identity.md.

import { userInfo } from "node:os";
import { loadSettings, saveSettings } from "@studio/engine-host/settings";
import { line } from "../logbus.ts";

/** What the frontend's `getMe` returns; anything else and `AuthGate` would draw a sign-in card. */
export interface DesktopUser {
  sub: string;
  name: string;
  email: string;
  groups: string[];
}

/**
 * A local identity that is stable across launches and looks like an email, because the slug
 * rule expects one. `@localhost` rather than a real domain: it must never collide with an
 * account someone actually has.
 */
function localDefault(): string {
  let who = "studio";
  try {
    who = userInfo().username || who;
  } catch {
    // No passwd entry (a bare container) — the constant is fine, it only has to be stable.
  }
  return `${who.replace(/[^A-Za-z0-9._-]/g, "") || "studio"}@localhost`;
}

/** The remembered identity, choosing and persisting one on first launch. */
export function currentIdentity(): string {
  const settings = loadSettings();
  if (settings.identity) return settings.identity;
  const chosen = localDefault();
  saveSettings({ ...settings, identity: chosen });
  line("host", `identity: ${chosen} (local, first launch)`);
  return chosen;
}

export function asUser(email: string): DesktopUser {
  return { sub: email, name: email.split("@")[0] ?? email, email, groups: [] };
}

/** Adopt a new identity. It used to MOVE the workspaces; there is no slug in the tree now — ../../docs/identity.md. */
export function adoptIdentity(next: string): { moved: boolean } {
  const settings = loadSettings();
  if (settings.identity === next) return { moved: false };
  saveSettings({ ...settings, identity: next });
  line("host", `identity: ${next}`);
  // Kept in the shape the caller reads, and now always false: the workspaces never move.
  return { moved: false };
}
