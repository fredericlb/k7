// SessionsSection.tsx — what this ONE engine is holding, and for whom. The status line could
// never say it: before sessions there was one project and nothing to list. Dropping a row drops
// that session's edit, plugins, meters and broadcast tap — the app driving it is not told, and
// simply finds an empty project. The tray put a ✕ on the row to say so; a page can say it in
// words. See apps/st0-desktop/docs/settings.md.

import type { HostCommandName } from "@studio/engine-host/hostProtocol";
import type { DesktopState } from "../desktop";
import {
  needsSessionPrefix,
  openablePlugins,
  pluginArg,
  sessionRow,
} from "./rules";
import { Action, Row, Section } from "./Section";

export function SessionsSection({
  state,
  send,
}: {
  state: DesktopState;
  send: (cmd: HostCommandName, arg?: string) => void;
}) {
  const s = state.snapshot;
  const sessions = s?.sessions ?? [];
  const openable = openablePlugins(s);
  const manySessions = needsSessionPrefix(s);

  return (
    <Section
      title="Sessions"
      hint="One engine holds several projects at once, one per app driving it."
    >
      {sessions.length === 0 ? (
        <Row label="No app is driving this engine" />
      ) : (
        sessions.map((x) => (
          // Shown only when true: a column of "0 listening" would bury the one that is.
          <Row key={x.id} {...sessionRow(x)}>
            <Action
              danger
              onClick={() => send("session.drop", x.id)}
              title="Drops its edit, plugins, meters and broadcast tap. The app driving it will find an empty project."
            >
              Drop
            </Action>
          </Row>
        ))
      )}

      {openable.length > 0 && (
        <>
          {openable.map((p) => (
            <Row
              key={pluginArg(p.session, p.id)}
              label={manySessions ? `${p.session} · ${p.name}` : p.name}
              detail="the plugin's own window, not the module's widget grid"
            >
              <Action
                onClick={() =>
                  send("plugin.showUI", pluginArg(p.session, p.id))
                }
              >
                Open UI
              </Action>
            </Row>
          ))}
        </>
      )}
    </Section>
  );
}
