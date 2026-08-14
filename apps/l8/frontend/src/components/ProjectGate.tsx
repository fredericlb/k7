// ProjectGate.tsx — l8's wrapper over the shared gate. The resolving, cloning and opening are
// @studio/project-shell's (m9 mounts the same thing); what belongs here is the wording, which
// is paraglide's, and what to render once the project is open. See @studio/project-shell docs/launch.md.

import { ProjectGate as Shared } from "@studio/project-shell/gate";
import App from "../App";
import { engines } from "../api";
import { m } from "../paraglide/messages.js";
import type { RankedEngine } from "../types";

export function ProjectGate({
  engine,
  onChangeEngine,
}: {
  engine: RankedEngine;
  /** Passed straight through to the settings menu: the engine choice belongs to the gate
   *  ABOVE this one, and a project has nothing to say about it. */
  onChangeEngine: () => void;
}) {
  return (
    <Shared
      engine={engine}
      app="l8"
      // The same two the router's basename is built from, in main.tsx — this reads the target
      // out of the address rather than being handed it, so both sides agree by construction.
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
        librariesTitle: m["project.librariesTitle"](),
        librariesBody: m["project.librariesBody"](),
        benchWorkspace: m["project.benchWorkspace"](),
        benchFetching: m["project.benchFetching"](),
      }}
    >
      {({ workspace, project, userEmail, quit }) => (
        // key by workspace+project so moving between them remounts the editor cleanly.
        <App
          key={`${workspace}/${project}`}
          // A function, not the address: the editor stays open for hours and the relayed URL
          // measured above carries a one-minute ticket. See @studio/engine-browser's EngineUrl.
          engineUrl={engines.linkUrl(engine)}
          // What this link measured, for the status bar. Passed down rather than re-probed:
          // the gate already paid for the round trip, and a second one would report a
          // different number for the same connection.
          engineLatency={engine.latency}
          // The RAW email, not a slug: sessionFor does the slugging, so this half and the
          // file service cannot drift on how it is spelled. See engine-protocol/sessions.
          userEmail={userEmail}
          onQuitWorkspace={quit}
          onChangeEngine={onChangeEngine}
        />
      )}
    </Shared>
  );
}
