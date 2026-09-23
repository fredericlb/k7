// SharedGate.tsx — the gate a SHARED link goes through, instead of AuthGate → EngineGate →
// ProjectGate. No account, no engine, no working copy: it hashes the token out of the address,
// asks pl8 for the snapshot's manifest, and points the file transport at it, frozen.
// See docs/shared.md.

import { Button } from "@frediverse/ui/button";
import { Download, Loader2, Lock } from "@frediverse/ui/icons";
import { configureFileApi } from "@studio/project-shell/fileApi";
import type {
  Alternatives,
  GitStatus,
  Hints,
  HistoryState,
  ProjectErrors,
  ProjectInfo,
  WebPreferences,
  WorkspaceInfo,
} from "@studio/web-protocol";
import { shareApiBase, shareKey } from "@studio/web-protocol/projects";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";

/** What a snapshot says about itself — `ShareManifest` in @studio/commands, as served. */
export interface ShareManifest {
  schema: number;
  name: string;
  createdAt: string;
  media: {
    mix: { file: string; bytes: number };
    stems: { id: string; track: string; name: string; file: string }[];
    video: boolean;
  };
  docs: string[];
  bytes: number;
}

export interface OpenShare {
  manifest: ShareManifest;
  /** `<origin>/api/public/share/<key>` — where the audio and the download hang off. */
  base: string;
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
  const git: GitStatus = {
    tracked: false,
    ahead: 0,
    behind: 0,
    conflicted: false,
  };
  const alternatives: Alternatives = { current: "", parent: "", branches: [] };
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
    "/git/status": git,
    "/git/alternatives": alternatives,
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
        if (manifest.schema > 1)
          return setPhase({
            k: "fault",
            why: `this snapshot was made by a newer version (schema ${manifest.schema})`,
          });
        // `/doc` is where the three documents answer; the identity fields are empty on purpose, a share having no user, workspace or engine.
        configureFileApi({
          base: `${base}/doc`,
          userEmail: "",
          workspace: "",
          engineToken: "",
          // …and no engine either, which is the same emptiness: a snapshot borrows no machine and writes nothing anywhere.
          engineId: "",
          frozen: {
            why: "this is a shared copy — it is frozen, and nothing here can be changed",
            canned: Object.fromEntries(
              Object.entries(cannedFor(manifest)).map(([k, v]) => [
                k,
                JSON.stringify(v),
              ]),
            ),
          },
        });
        setPhase({ k: "open", share: { manifest, base } });
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

/** The one thing a visitor may take away, as a plain link — a download is a navigation, and fetch would only buy a blob URL. */
export function ShareDownload({ base }: { base: string }) {
  return (
    // 24 px like every other control in the bar: the header's height is whatever its tallest child is.
    <Button
      asChild
      variant="secondary"
      size="sm"
      className="h-6 gap-1 px-2 text-xs"
    >
      <a href={`${base}/download`} download>
        <Download className="h-3.5 w-3.5" /> {m["share.download"]()}
      </a>
    </Button>
  );
}
