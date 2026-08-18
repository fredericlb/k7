// SharedGate.tsx — the gate a SHARED link goes through, instead of AuthGate → EngineGate →
// ProjectGate. No account, no engine, no working copy: it hashes the token out of the address,
// asks st0 for the snapshot's manifest, and points the file transport at it, frozen.
// See docs/shared.md.

import { Button } from "@frediverse/ui/button";
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
import { Download, Loader2, Lock } from "lucide-react";
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
  // The 404 a withdrawn share answers, and the one a mistyped address answers. ONE screen for
  // both, because the server cannot tell them apart either and pretending otherwise would be
  // making something up about somebody else's link.
  | { k: "gone" }
  | { k: "fault"; why: string }
  | { k: "open"; share: OpenShare };

/**
 * The routes a snapshot has no answer for, and the answer each one gets instead.
 *
 * A share is a folder of JSON and audio — three compiled documents and the renders. There is no
 * file service behind it, so `/tree`, `/hints`, `/commands` and the rest name nothing at all.
 * Left to fail, every hook that asks would draw an error about a service being down, which is
 * FALSE: it is absent by design, and a viewer telling you the server is broken when it is doing
 * exactly what it should is worse than one that says nothing.
 *
 * Each value is TYPED rather than cast, so a field added to one of these shapes fails this file
 * instead of arriving at a component as `undefined` on the one code path nobody opens.
 *
 * `revision` is the load-bearing one: several hooks poll it and re-fetch when it moves. A
 * constant is what makes the whole shell settle after its first pass and then stop asking —
 * which is the true statement about a document that cannot change.
 */
function cannedFor(manifest: ShareManifest): Record<string, unknown> {
  const project: ProjectInfo = { name: manifest.name, root: "" };
  // `activeProject` is set, and that is not cosmetic: null draws the amber "pick a project"
  // badge, which asks a visitor to do something no screen here offers.
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
  // Clean, and TRUE rather than a stand-in: a snapshot is built from a project that compiled,
  // by the machine that compiled it. Nothing here could produce an error to report.
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
        // The KEY is derived here and the token never leaves this tab as a path segment — see
        // shareKey, including why this needs https and says so when it has not got it.
        const base = shareApiBase(
          window.location.origin,
          await shareKey(token),
        );
        const res = await fetch(`${base}/manifest`);
        if (stop) return;
        if (!res.ok) return setPhase({ k: "gone" });
        const manifest = (await res.json()) as ShareManifest;
        if (stop) return;
        // A schema this build cannot read is a FAULT and not a 404: the link is fine, the
        // snapshot is fine, and this viewer is the one that is out of date.
        if (manifest.schema > 1)
          return setPhase({
            k: "fault",
            why: `this snapshot was made by a newer version (schema ${manifest.schema})`,
          });
        // `/doc` because that is where the three documents answer, and the transport asks for
        // them by the file service's route names — `/project-doc`, `/graph`, `/surfaces`. The
        // identity fields are empty on purpose: a share has no user, no workspace and no engine,
        // and the headers they fill are ignored by a route that authenticates nothing.
        configureFileApi({
          base: `${base}/doc`,
          userEmail: "",
          workspace: "",
          engineToken: "",
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

  // No "back to Projects" on either failure, and that is the point of the whole feature: whoever
  // is reading this has no account here, so an invitation to sign in would be the one thing that
  // cannot help them.
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

/** The one thing a visitor may take away, as a plain link — a download is a navigation, and
 *  wiring it through fetch would only buy a blob URL and a copy of the file in memory. */
export function ShareDownload({ base }: { base: string }) {
  return (
    <Button asChild variant="secondary" size="sm">
      <a href={`${base}/download`} download>
        <Download className="h-4 w-4" /> {m["share.download"]()}
      </a>
    </Button>
  );
}
