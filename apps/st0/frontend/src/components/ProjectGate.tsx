// ProjectGate.tsx — st0's wrapper over the shared gate. The resolving, cloning and opening are
// @studio/project-shell's (z0's editor mounts the same thing); what belongs here is the wording, which
// is paraglide's, and what to render once the project is open. See @studio/project-shell docs/launch.md.

import { ProjectGate as Shared } from "@studio/project-shell/gate";
import { IDLE_TIMEOUT_MS } from "@studio/project-shell/idle";
import type { AccountLibrary } from "@studio/web-protocol";
import { useCallback, useEffect, useState } from "react";
import App from "../App";
import { engines } from "../api";
import { m } from "../paraglide/messages.js";
import { FirstProject } from "../projects/FirstProject";
import { LibrariesCard } from "../projects/LibrariesCard";
import type { AccountFiles } from "../projects/workspaceOps";
import { findAccountFiles } from "../settings/accountFiles";
import { useInFront } from "../tabs/useInFront";
import type { RankedEngine } from "../types";
import { ExternalSurface } from "./ExternalSurface";

export function ProjectGate({
  engine,
  external,
  onChangeEngine,
  onSwitchEngine,
  onIdle,
  onResume,
}: {
  engine: RankedEngine;
  /** A surface's name, when this tab was opened on ONE surface — the gates above are the same either way, only the rendering differs. */
  external?: string | null;
  /** Passed straight through to the settings menu: the engine choice belongs to the gate ABOVE this one. */
  onChangeEngine: () => void;
  /** Move this project to another measured engine — the header's engine menu; the gate above does it. */
  onSwitchEngine: (r: RankedEngine) => void;
  /** The session went to sleep — the lease belongs to the gate ABOVE, so this only forwards the news (@studio/project-shell/docs/idle.md). */
  onIdle: () => void;
  /** …and taking it back. */
  onResume: () => void;
}) {
  // A tab behind another stops being that engine's client too, and does not wait twenty minutes — apps/st0-desktop/docs/tabs.md.
  const inFront = useInFront();
  return (
    <Shared
      engine={engine}
      app="st0"
      // Twenty minutes untouched and this tab stops being a client of that engine.
      idleTimeoutMs={IDLE_TIMEOUT_MS}
      asleep={!inFront}
      onIdle={onIdle}
      onResume={onResume}
      // The same two the router's basename is built from, read out of the address rather than handed over, so both sides agree.
      base={import.meta.env.BASE_URL}
      strings={{
        cloning: (workspace) => m["project.cloning"]({ workspace }),
        back: m["project.backToProjects"](),
        retry: "Retry",
        unreachableTitle: m["filesGate.title"](),
        unreachableBody: (base) => m["filesGate.downBody"]({ base }),
        blockedTitle: m["filesGate.blockedTitle"](),
        blockedBody: (origin) => m["filesGate.blockedBody"]({ origin }),
        bothBody: m["filesGate.body"](),
        missingTitle: m["project.missingTitle"](),
        missingBody: m["project.missingBody"](),
        emptyWorkspace: m["project.emptyWorkspace"](),
        librariesTitle: m["project.librariesTitle"](),
        librariesBody: m["project.librariesBody"](),
        benchWorkspace: m["project.benchWorkspace"](),
        benchFetching: m["project.benchFetching"](),
        idleTitle: m["project.idleTitle"](),
        // The number comes from the constant rather than from the wording: two places saying 'twenty minutes' end up disagreeing.
        idleBody: m["project.idleBody"]({
          minutes: Math.round(IDLE_TIMEOUT_MS / 60000),
        }),
        resume: m["project.resume"](),
      }}
      /* A workspace with nothing in it asks for its first project rather than refusing to open. */
      renderEmpty={({ workspace, onCreated }) => (
        <FirstProject workspace={workspace} onCreated={onCreated} />
      )}
      /* No library: the home page's card, right here, and the first one added opens the project. */
      renderNoLibraries={({ onAdded }) => <AddLibrary onAdded={onAdded} />}
    >
      {({ workspace, project, userEmail, quit }) =>
        external ? (
          <ExternalSurface
            key={`${workspace}/${project}/${external}`}
            name={external}
            project={project}
            engineUrl={engines.linkUrl(engine)}
            userEmail={userEmail}
          />
        ) : (
          // key by workspace+project so moving between them remounts the editor cleanly.
          <App
            key={`${workspace}/${project}`}
            // A function, not the address: the editor stays open for hours and the relayed URL carries a one-minute ticket.
            engineUrl={engines.linkUrl(engine)}
            // What this link measured, passed down rather than re-probed: a second round trip would report a different number.
            engineLatency={engine.latency}
            // The RAW email, not a slug: `sessionFor` does the slugging, so this half and the file service cannot drift.
            userEmail={userEmail}
            onQuitWorkspace={quit}
            onChangeEngine={onChangeEngine}
            engine={engine}
            onSwitchEngine={onSwitchEngine}
          />
        )
      }
    </Shared>
  );
}

/** The libraries card on the account's file service, found the way the home page finds it. */
function AddLibrary({ onAdded }: { onAdded: () => void }) {
  const [fileService, setFileService] = useState<AccountFiles | null>(null);
  useEffect(() => {
    let live = true;
    void findAccountFiles(false).then((f) => live && setFileService(f));
    return () => {
      live = false;
    };
  }, []);
  // Stable, since the card reports from an effect keyed on it.
  const onLibraries = useCallback(
    (l: AccountLibrary[]) => {
      if (l.length) onAdded();
    },
    [onAdded],
  );
  return <LibrariesCard fileService={fileService} onLibraries={onLibraries} />;
}
