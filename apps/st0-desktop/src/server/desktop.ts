// desktop.ts — the two routes the settings screen runs on, and the ONE route that tells st0
// it is running in the desktop app at all. A hosted st0 answers none of them, so the web build
// simply never offers the screen — no build flag, no user agent sniffing, just a probe.
//
// Loopback only, all three. These start and stop an engine and edit the CORS allowlist; a
// second device on the LAN has no business doing either (see origin.ts).
// See ../../docs/settings.md.

import type {
  HostCommandName,
  HostSnapshot,
} from "@studio/engine-host/hostProtocol";
import type { Express } from "express";
import { isLoopback } from "./origin.ts";

/** Everything the screen draws, in one reply: the supervisor's half and the app's own. */
export interface DesktopState {
  /** The supervisor's snapshot, or null before the first frame arrives. */
  snapshot: HostSnapshot | null;
  /** A sentence when the supervisor itself is the thing that broke — it REPLACES the status. */
  hostError: string | null;
  build: string;
  autostart: boolean;
  /** Who this machine's workspaces belong to (docs/identity.md). */
  identity: string;
  /** The paired server's origin, or null. */
  server: string | null;
  paired: boolean;
  /** Where this app is serving from — the address a second device uses (docs/externals.md). */
  lanUrls: string[];
  /** The project the window is on, or null — what a SECOND window would open on (docs/window.md). */
  frontProject: string | null;
}

export interface DesktopHooks {
  state: () => DesktopState;
  /** Straight to the supervisor: the screen sends the SAME commands the menu does. */
  send: (cmd: HostCommandName, arg?: string) => void;
  /** The rows the supervisor has no command for — autostart, opening a folder, pairing. */
  local: (
    what: string,
    arg?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
}

export function mountDesktopApi(app: Express, hooks: DesktopHooks): void {
  // The probe. 404 elsewhere is the whole mechanism: st0 asks, and a hosted backend has no
  // such route, so `/@settings` is offered on the desktop and nowhere else.
  app.get("/desktop/state", (req, res) => {
    if (!isLoopback(req))
      return res.status(403).json({ error: "this machine only" });
    res.json(hooks.state());
  });

  app.post("/desktop/command", (req, res) => {
    if (!isLoopback(req))
      return res.status(403).json({ error: "this machine only" });
    const { cmd, arg } = (req.body ?? {}) as { cmd?: string; arg?: string };
    if (!cmd) return res.status(400).json({ error: "no command" });
    hooks.send(cmd as HostCommandName, arg);
    // Fire and forget, exactly as the menu does: the answer is the next snapshot, and a
    // reply that pretended otherwise would be inventing a result the supervisor never sent.
    res.json({ ok: true });
  });

  app.post("/desktop/local", (req, res) => {
    if (!isLoopback(req))
      return res.status(403).json({ error: "this machine only" });
    const { what, arg } = (req.body ?? {}) as { what?: string; arg?: string };
    if (!what) return res.status(400).json({ error: "no action" });
    void hooks
      .local(what, arg)
      .then((r) => res.status(r.ok ? 200 : 400).json(r))
      .catch((e: unknown) =>
        res.status(500).json({ ok: false, error: String(e) }),
      );
  });
}
