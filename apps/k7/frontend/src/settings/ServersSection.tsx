// ServersSection.tsx — on a machine (the tray, a phone app), the servers its account has saved: the ACTIVE one marked,
// "Use this server" on the others, Remove on each, and Add, which pairs through the browser and makes the new one active.
// A server's page draws nothing here: it is the server. See ../../docs/settings.md and ../../docs/localApp.md.

import { Check, Plus, X } from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { useState } from "react";
import { useLocalApp } from "../localApp";
import { m } from "../paraglide/messages.js";
import { hostLabel } from "../projects/WorkspaceSyncIcon";
import { accountBridge } from "../tabs/bridge";
import { onAndroid } from "./androidEngine";
import { Action, Row, Section } from "./Section";
import {
  type SavedServer,
  savedServersCall,
  serverLabel,
  useSavedServers,
} from "./savedServers";

/** A pairing adds its server only once the browser comes back: the list is asked again until it shows. */
const AFTER_ADD_MS = 3000;

export function ServersSection() {
  const local = useLocalApp();
  if (!local && !onAndroid) return null;
  return <Servers />;
}

function Servers() {
  const { servers, reload } = useSavedServers();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const bridge = accountBridge();

  const act = (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void run()
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false);
        reload();
      });
  };
  const use = (s: SavedServer) =>
    act(() => savedServersCall("POST", "/active", { id: s.id }));
  const remove = async (s: SavedServer) => {
    const ok = await askConfirm({
      title: m["servers.removeTitle"]({ server: serverLabel(s) }),
      body: m["servers.removeBody"](),
      confirmLabel: m["servers.remove"](),
      danger: true,
    });
    if (ok)
      act(() => savedServersCall("DELETE", `?id=${encodeURIComponent(s.id)}`));
  };

  const origin = adding === null ? null : normalizeServer(adding);
  const add = async () => {
    if (!origin) return;
    // A server already saved: its page asks which other account to add.
    const known = (servers ?? []).some(
      (s) => hostLabel(s.origin) === hostLabel(origin),
    );
    setAdding(null);
    const asked = known
      ? await bridge?.addAccount?.(origin)
      : await bridge?.addServer?.(origin);
    if (asked) setTimeout(reload, AFTER_ADD_MS);
  };

  return (
    <Section title={m["servers.title"]()} hint={m["servers.hint"]()}>
      {servers?.length === 0 && <Row label={m["servers.none"]()} />}
      {(servers ?? []).map((s) => (
        <Row key={s.id} label={serverLabel(s)}>
          {s.active ? (
            <span className="flex items-center gap-1 px-2.5 py-1 text-primary-text text-xs">
              <Check className="size-3" /> {m["servers.active"]()}
            </span>
          ) : (
            <Action disabled={busy} onClick={() => use(s)}>
              {m["servers.use"]()}
            </Action>
          )}
          <Action danger disabled={busy} onClick={() => void remove(s)}>
            {m["servers.remove"]()}
          </Action>
        </Row>
      ))}
      {bridge?.addServer &&
        (adding === null ? (
          <Row label={m["servers.add"]()} detail={m["servers.addHint"]()}>
            <Action disabled={busy} onClick={() => setAdding("")}>
              <span className="flex items-center gap-1">
                <Plus className="size-3" /> {m["servers.add"]()}
              </span>
            </Action>
          </Row>
        ) : (
          <form
            className="flex items-center gap-2 px-4 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              // biome-ignore lint/a11y/noAutofocus: the field exists only because the person just asked for it.
              autoFocus
              className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 text-xs outline-none focus:border-primary ${origin || !adding ? "border-border" : "border-red-400"}`}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(null)}
              placeholder="k7.example.org"
              aria-label={m["servers.add"]()}
              spellCheck={false}
            />
            <Action disabled={!origin} onClick={() => void add()}>
              {m["servers.addConfirm"]()}
            </Action>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => setAdding(null)}
              aria-label={m["common.cancel"]()}
            >
              <X className="size-3.5" />
            </button>
          </form>
        ))}
      {error && <Row label={m["servers.failed"]({ error })} />}
    </Section>
  );
}
