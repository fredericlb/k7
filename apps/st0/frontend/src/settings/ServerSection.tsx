// ServerSection.tsx — everything about reaching this machine from somewhere else: the server it
// is paired with, the web UIs allowed to drive its engine, and the LAN address a second device
// opens. The "Blocked just now" list is the one that matters: the file service records an origin
// it refused, and allowing it is a click rather than a file to find and edit.
// See apps/studio-desktop/docs/settings.md.

import type { HostCommandName } from "@studio/engine-host/hostProtocol";
import { useState } from "react";
import type { DesktopState, LocalAction } from "../desktop";
import { Action, Row, Section } from "./Section";

export function ServerSection({
  state,
  send,
  local,
}: {
  state: DesktopState;
  send: (cmd: HostCommandName, arg?: string) => void;
  local: (what: LocalAction, arg?: string) => void;
}) {
  const s = state.snapshot;
  const [server, setServer] = useState(state.server ?? "");

  return (
    <>
      <Section
        title="Server"
        hint="Everything works without one. A server adds project links, pl8's catalogue and the repository register."
      >
        <Row
          label={state.server ? state.server : "Not connected"}
          detail={
            state.server
              ? state.paired
                ? `paired as ${state.identity}`
                : "set, but not paired yet — sign in to finish"
              : `working locally as ${state.identity}`
          }
        >
          {state.server && (
            <Action onClick={() => local("pair")}>
              {state.paired ? "Sign in again" : "Sign in"}
            </Action>
          )}
          {state.server && (
            <Action danger onClick={() => local("unpair")}>
              Disconnect
            </Action>
          )}
        </Row>
        <Row
          label={
            <input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="https://studio.example.com"
              className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 text-sm"
            />
          }
          detail="Signing in happens in your browser, on the server's own address — never in a window here."
        >
          <Action
            onClick={() => local("setServer", server.trim())}
            disabled={!server.trim() || server.trim() === state.server}
          >
            Save
          </Action>
        </Row>
      </Section>

      <Section
        title="Web UIs"
        hint="Which browsers may drive this engine. A loopback or private address is always allowed; a real hostname has to be listed."
      >
        {(s?.webPending ?? []).length > 0 && (
          <>
            {s?.webPending.map((o) => (
              <Row key={`pending:${o}`} label={o} detail="blocked just now">
                <Action onClick={() => send("weburi.allow", o)}>Allow</Action>
                <Action onClick={() => send("weburi.deny", o)}>Ignore</Action>
              </Row>
            ))}
          </>
        )}
        {(s?.webOrigins ?? []).length === 0 ? (
          <Row label="No web UI added" />
        ) : (
          s?.webOrigins.map((o) => (
            <Row key={o} label={o}>
              <Action danger onClick={() => send("weburi.remove", o)}>
                Remove
              </Action>
            </Row>
          ))
        )}
      </Section>

      <Section
        title="A second device"
        hint="The same app, reached over your network. It opens one surface of a project on its own."
      >
        {state.lanUrls.length === 0 ? (
          <Row
            label="No network address"
            detail="this machine is only reachable from itself"
          />
        ) : (
          state.lanUrls.map((u) => (
            <Row
              key={u}
              label={`${u}/external`}
              detail="open this on the other device"
            >
              <Action
                onClick={() =>
                  void navigator.clipboard.writeText(`${u}/external`)
                }
              >
                Copy
              </Action>
            </Row>
          ))
        )}
        {/* Written down rather than discovered: `http://192.168.x.x` is not a secure context. */}
        <Row
          label="No install, and no camera, on that device"
          detail="A network address is not a secure context, so a browser there offers no app install and no webcam. Connect a server and it uses that address instead, with neither limitation."
        />
      </Section>
    </>
  );
}
