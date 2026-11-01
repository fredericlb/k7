// ServersSection.tsx — on a machine (the tray, a phone app), its ONE server: who it is signed in to there, and Sign out;
// or, signed in nowhere, the address to sign in to. Signing in is linking (../tabs/connectServer.ts).
// A server's page draws nothing here: it is the server. See ../../docs/settings.md and ../../docs/localApp.md.

import { askConfirm } from "@studio/project-shell/ask";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { STUDIO_ORIGIN } from "@studio/web-protocol/services";
import { useState } from "react";
import { useLocalApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { AccountStatusNote } from "../tabs/AccountStatusNote";
import { connectServer, signOutServer } from "../tabs/connectServer";
import { onAndroid } from "./androidEngine";
import { Action, Row, Section } from "./Section";
import { serverLabel, useSavedServers } from "./savedServers";

export function ServersSection() {
  const local = useLocalApp();
  if (!local && !onAndroid) return null;
  return <Servers />;
}

function Servers() {
  const { servers, reload } = useSavedServers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState(
    STUDIO_ORIGIN.replace(/^https:\/\//, ""),
  );
  const [active] = servers ?? [];
  const origin = normalizeServer(address);

  const signIn = async () => {
    if (!origin) return;
    setBusy(true);
    setError(null);
    const linked = await connectServer(origin);
    setBusy(false);
    // Signed in, the page reads again with that server's workspaces.
    if (linked) location.reload();
  };
  const signOut = async () => {
    const ok = await askConfirm({
      title: m["servers.signOutTitle"]({ server: serverLabel(active) }),
      body: m["servers.signOutBody"](),
      confirmLabel: m["servers.signOut"](),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    await signOutServer().catch((e: Error) => setError(e.message));
    setBusy(false);
    reload();
    location.reload();
  };

  return (
    <Section title={m["servers.title"]()} hint={m["servers.hint"]()}>
      {servers !== null &&
        (active ? (
          <Row label={serverLabel(active)} detail={m["servers.signedIn"]()}>
            <Action danger disabled={busy} onClick={() => void signOut()}>
              {m["servers.signOut"]()}
            </Action>
          </Row>
        ) : (
          <form
            className="flex items-center gap-2 px-4 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void signIn();
            }}
          >
            <input
              className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 text-xs outline-none focus:border-primary ${origin || !address ? "border-border" : "border-red-400"}`}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="app.k7.rocks"
              aria-label={m["serverPrompt.address"]()}
              spellCheck={false}
            />
            <Action disabled={!origin || busy} onClick={() => void signIn()}>
              {m["serverPrompt.connect"]()}
            </Action>
          </form>
        ))}
      <AccountStatusNote />
      {error && <Row label={m["servers.failed"]({ error })} />}
    </Section>
  );
}
