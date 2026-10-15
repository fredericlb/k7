// SharedGate.tsx — the gate a SHARED link goes through, instead of AuthGate → EngineGate → ProjectGate. No account
// and no working copy: it hashes the token out of the address, asks the media library for the share's manifest,
// points the file transport at its documents, read-only, and hands the shell the share's player as its engine.
// See docs/shared.md.

import { Loader2, Lock } from "@frediverse/ui/icons";
import { configureFileApi } from "@studio/project-shell/fileApi";
import {
  type ShareManifest as FullManifest,
  type Hints,
  type HistoryState,
  type ProjectErrors,
  type ProjectInfo,
  SHARE_SCHEMA,
  type WebPreferences,
  type WorkspaceInfo,
} from "@studio/web-protocol";
import { shareApiBase, shareKey } from "@studio/web-protocol/projects";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";

/** What a share says about itself to a visitor: its manifest without the server's own file list. */
export type ShareManifest = Omit<FullManifest, "files" | "engineDoc">;

export interface OpenShare {
  manifest: ShareManifest;
  /** `<origin>/api/public/share/<key>` — where the documents and the comments hang off. */
  base: string;
  /** The visitor's own session on the server's engine (the backend's player.ts), as the shell's engine address. */
  player: string;
}

type Phase =
  | { k: "opening" }
  // The 404 a withdrawn share answers, and the one a mistyped address answers: ONE screen, the server not telling them apart either.
  | { k: "gone" }
  | { k: "fault"; why: string }
  | { k: "open"; share: OpenShare };

/** The routes a snapshot has no answer for, and the canned answer each gets — `revision` is the load-bearing one, being what makes the shell settle. */
function cannedFor(manifest: ShareManifest): Record<string, unknown> {
  const project: ProjectInfo = { name: manifest.name, root: "" };
  // `activeProject` is set, and that is not cosmetic: null draws the amber badge, asking for something no screen here offers.
  const workspace: WorkspaceInfo = {
    root: "",
    rootIsProject: true,
    activeProject: ".",
    projects: ["."],
    lastTake: null,
  };
  const hints: Hints = {
    baseModules: [],
    ioSinks: [],
    modules: [],
    tracks: [],
    channels: [],
    clips: [],
    videoTracks: [],
    sequences: [],
    chains: [],
    moduleAssets: {},
    paramsByBase: {},
    paramMetaByBase: {},
    racks: {},
    keywords: [],
    pluginNames: {},
    paths: {},
    projectRoot: "",
    media: {},
  };
  // Clean, and TRUE rather than a stand-in: a snapshot is built from a project that compiled, by the machine that compiled it.
  const clean: ProjectErrors = { errors: [], diagnostics: [] };
  const history: HistoryState = { canUndo: false, canRedo: false };
  const preferences: WebPreferences = {
    audioDevice: null,
    channels: { in: "", out: "" },
    vim: false,
    // A snapshot has no machine behind it, so nothing here could separate anything.
    stemsChain: null,
    instrumentalChain: null,
  };
  return {
    "/project": project,
    "/workspace": workspace,
    "/revision": { rev: "frozen" },
    "/tree": [],
    "/hints": hints,
    "/commands": [],
    "/base-modules": [],
    "/io-ports": [],
    "/module-catalogue": [],
    "/module-libraries": { libraries: [] },
    "/library-chains": { chains: [] },
    "/project-errors": clean,
    "/video-errors": clean,
    "/history": history,
    "/preferences": preferences,
  };
}

export function SharedGate({
  token,
  children,
}: {
  token: string;
  children: (share: OpenShare) => React.ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>({ k: "opening" });

  useEffect(() => {
    let stop = false;
    void (async () => {
      try {
        // The KEY is derived here and the token never leaves this tab as a path segment — see shareKey.
        const base = shareApiBase(
          window.location.origin,
          await shareKey(token),
        );
        const res = await fetch(`${base}/manifest`);
        if (stop) return;
        if (!res.ok) return setPhase({ k: "gone" });
        const manifest = (await res.json()) as ShareManifest;
        if (stop) return;
        // A schema this build cannot read is a FAULT and not a 404: this viewer is the one that is out of date.
        if (manifest.schema !== SHARE_SCHEMA)
          return setPhase({
            k: "fault",
            why: `this share was made by another version of k7 (schema ${manifest.schema})`,
          });
        // `/doc` is where the three documents answer; the identity fields are empty on purpose, a share having no user, workspace or engine.
        configureFileApi({
          base: `${base}/doc`,
          userEmail: "",
          workspace: "",
          engineToken: "",
          // …and no engine of its own: the server's plays the share, through the player and not the registry.
          engineId: "",
          frozen: {
            why: "this is a shared version — read only, except what you mute and solo",
            canned: Object.fromEntries(
              Object.entries(cannedFor(manifest)).map(([k, v]) => [
                k,
                JSON.stringify(v),
              ]),
            ),
          },
        });
        // Same origin as the documents, as a socket: the visitor's session on the server's engine.
        const player = `${base.replace(/^http/, "ws")}/play`;
        setPhase({ k: "open", share: { manifest, base, player } });
      } catch (e) {
        if (!stop) setPhase({ k: "fault", why: (e as Error).message });
      }
    })();
    return () => {
      stop = true;
    };
  }, [token]);

  if (phase.k === "open") return <>{children(phase.share)}</>;

  if (phase.k === "opening")
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {m["share.opening"]()}
      </div>
    );

  // No 'back to Projects' on either failure: whoever is reading has no account here, so an invitation to sign in cannot help.
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="flex max-w-md flex-col gap-3 text-center">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" />
        <h1 className="text-lg font-medium">
          {phase.k === "gone"
            ? m["share.goneTitle"]()
            : m["share.faultTitle"]()}
        </h1>
        <p className="text-sm text-muted-foreground">
          {phase.k === "gone" ? m["share.goneBody"]() : phase.why}
        </p>
      </div>
    </div>
  );
}
