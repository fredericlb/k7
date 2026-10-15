// SyncServers.tsx — the servers a signed-in desktop account syncs with, in the home page's account bar: the
// MAIN one (libraries, new workspaces), the others beside it, each one made main or let go, and another added.
// Adding pairs through the system browser like the main one does (the app's main process); the rest is the
// local backend's `/api/sync/remote`. See apps/k7-standalone/docs/sync.md, "Several servers".

import { Check, Plus, Star, X } from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { useCallback, useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { tabsBridge } from "../tabs/bridge";
import { hostLabel } from "./WorkspaceSyncIcon";

interface Server {
  url: string;
  main: boolean;
}

/** A pairing adds a server only once the browser comes back: the list is asked again until it shows. */
const AFTER_ADD_MS = 3000;

async function remote(
  method: string,
  path = "",
  body?: unknown,
): Promise<{ servers?: Server[] } | null> {
  try {
    const r = await fetch(`/api/sync/remote${path}`, {
      method,
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    return r.ok ? ((await r.json()) as { servers?: Server[] }) : null;
  } catch {
    return null;
  }
}

/** A relay socket as the page names its server: `wss://st0.app/api/sync` → `st0.app`. */
const hostOf = (url: string): string => hostLabel(url.replace(/^ws/, "http"));

export function SyncServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const reload = useCallback(() => {
    void remote("GET").then((r) => setServers(r?.servers ?? []));
  }, []);
  useEffect(reload, [reload]);

  // The field for another server: null while closed.
  const [adding, setAdding] = useState<string | null>(null);
  const valid = adding !== null && normalizeServer(adding) !== null;
  const add = async () => {
    if (adding === null || !valid) return;
    const asked = await tabsBridge()?.addServer?.(adding);
    setAdding(null);
    // The pairing finishes in the browser: the list grows when it has.
    if (asked) setTimeout(reload, AFTER_ADD_MS);
  };

  const makeMain = (s: Server) =>
    void remote("POST", "/main", { url: s.url }).then(reload);
  const forget = async (s: Server) => {
    const server = hostOf(s.url);
    if (
      !(await askConfirm({
        title: m["account.removeServerTitle"]({ server }),
        body: m["account.removeServerBody"](),
        confirmLabel: m["common.remove"](),
        danger: true,
      }))
    )
      return;
    await remote("DELETE", `?url=${encodeURIComponent(s.url)}`);
    reload();
  };

  if (!servers.length) return null;
  const button =
    "rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span>{m["account.servers"]()}</span>
      {servers.map((s) => (
        <span
          key={s.url}
          className="flex items-center gap-1 rounded-md bg-secondary/60 px-2 py-0.5"
        >
          <span className="text-foreground">{hostOf(s.url)}</span>
          {s.main ? (
            <span className="text-primary">{m["account.main"]()}</span>
          ) : (
            <>
              <button
                type="button"
                className={button}
                title={m["account.makeMain"]()}
                aria-label={m["account.makeMain"]()}
                onClick={() => makeMain(s)}
              >
                <Star className="size-3" />
              </button>
              <button
                type="button"
                className={button}
                title={m["account.removeServer"]({ server: hostOf(s.url) })}
                aria-label={m["account.removeServer"]({
                  server: hostOf(s.url),
                })}
                onClick={() => void forget(s)}
              >
                <X className="size-3" />
              </button>
            </>
          )}
        </span>
      ))}
      {adding === null ? (
        tabsBridge()?.addServer && (
          <button
            type="button"
            className={`${button} flex items-center gap-1 px-1.5`}
            title={m["account.addServerHint"]()}
            onClick={() => setAdding("")}
          >
            <Plus className="size-3" /> {m["account.addServer"]()}
          </button>
        )
      ) : (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: the field exists only because the person just asked for it.
            autoFocus
            className={`w-44 rounded-md border bg-secondary px-2 py-0.5 text-xs outline-none focus:border-primary ${valid || !adding ? "border-border" : "border-red-400"}`}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(null)}
            placeholder="k7.example.org"
            aria-label={m["account.addServer"]()}
            spellCheck={false}
          />
          <button
            type="submit"
            className={button}
            disabled={!valid}
            aria-label={m["account.addServer"]()}
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setAdding(null)}
            aria-label="Cancel"
          >
            <X className="size-3.5" />
          </button>
        </form>
      )}
    </div>
  );
}
