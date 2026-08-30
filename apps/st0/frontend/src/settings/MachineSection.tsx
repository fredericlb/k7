// MachineSection.tsx — the machine's own rows: whether the app comes back at login, the folders
// it keeps, and the build. The Misc tab, and deliberately the last one — nothing here is
// touched twice in a session. See apps/studio-desktop/docs/settings.md.

import type { DesktopState, LocalAction } from "../desktop";
import { Action, Row, Section } from "./Section";

export function MachineSection({
  state,
  local,
}: {
  state: DesktopState;
  local: (what: LocalAction, arg?: string) => void;
}) {
  const s = state.snapshot;

  return (
    <Section title="This machine">
      <Row
        label="Open studio when I log in"
        detail="The engine starts with the window and stops with it; `studio-engine` is the one that needs neither."
      >
        <Action onClick={() => local("autostart")}>
          {state.autostart ? "On" : "Off"}
        </Action>
      </Row>
      <Row label="Workspaces folder" detail={s?.paths.root}>
        <Action onClick={() => local("openRoot")}>Open</Action>
      </Row>
      <Row label="Logs" detail={s?.paths.mergedLog}>
        <Action onClick={() => local("openLog")}>Show</Action>
      </Row>
      <Row
        label="Settings file"
        detail="Ports and other rarely-changed things; hand-editable on purpose."
      >
        <Action onClick={() => local("openSettingsFile")}>Open</Action>
      </Row>
      <Row label={`build ${state.build}`} />
    </Section>
  );
}
