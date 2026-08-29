// identity.ts — who this machine's workspaces belong to. The file service keys
// `~/.studio/root/<slug>` on an email (engine-client/paths' `slugify`), and offline there is
// no OIDC to ask for one — so it is REMEMBERED. The hazard this file exists for: pairing a
// server later changes the answer, and with it the slug, and every offline project would
// simply stop being listed. Nothing errors. See ../../docs/identity.md.

import { existsSync, renameSync } from "node:fs";
import { userInfo } from "node:os";
import { slugify, userRoot } from "@studio/engine-client/paths";
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

/**
 * Adopt a new identity, taking the workspaces with it.
 *
 * This is the whole point of the file. Pair a server and the identity becomes the account's
 * email; the slug changes; `listWorkspaces` finds nothing under the new one and cheerfully
 * bootstraps a fresh empty `Examples`. The user's reading of that is "my songs are gone",
 * with no error anywhere to disagree. `rename-test-plan.md` already names `root/` as the one
 * thing that does not regenerate.
 *
 * Renames only when the old root exists and the new one does NOT — merging two real roots is
 * a decision, not a migration, and is left to the person who has both.
 */
export function adoptIdentity(next: string): { moved: boolean } {
  const settings = loadSettings();
  const prev = settings.identity;
  if (prev === next) return { moved: false };

  let moved = false;
  if (prev) {
    const from = userRoot(slugify(prev));
    const to = userRoot(slugify(next));
    if (existsSync(from) && !existsSync(to)) {
      try {
        renameSync(from, to);
        moved = true;
        line("host", `workspaces moved with the identity: ${from} → ${to}`);
      } catch (e) {
        // Loud, because the consequence is an apparently empty machine.
        line("host", `could not move ${from} → ${to}: ${String(e)}`);
      }
    } else if (existsSync(from) && existsSync(to)) {
      line(
        "host",
        `both ${from} and ${to} exist — leaving them alone; the old workspaces are still there`,
      );
    }
  }
  saveSettings({ ...settings, identity: next });
  return { moved };
}
