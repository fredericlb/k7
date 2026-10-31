// SyncServers.tsx — the links a k7 account syncs with, in the home page's account bar: each one account on one server,
// `host · account`, the MAIN one (libraries, new workspaces) among them, each made main or let go by its id, and another
// server or another account on a linked server added. On a server the main one is the server itself, listed first and
// fixed. Adding pairs through the browser (../tabs/browserAccount.ts); the rest is `/api/sync/remote`
// (packages/file-hub/docs/syncRelay.md).

import { Check, Plus, Star, UserPlus, X } from "@frediverse/ui/icons";
import { askConfirm } from "@studio/project-shell/ask";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { useCallback, useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { accountBridge } from "../tabs/bridge";
import { linkLabel } from "./syncLinks";
import { hostLabel } from "./WorkspaceSyncIcon";

interface Link {
  id: string;
  url: string;
  origin: string;
  as: string;
  main: boolean;
  /** The server this page is served by, which stays the main one. */
  own?: boolean;
}

/** A pairing adds a link only once the browser comes back: the list is asked again until it shows. */
const AFTER_ADD_MS = 3000;

async function remote(
  method: string,
  path = "",
  body?: unknown,
): Promise<{ servers?: Link[] } | null> {
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
    return r.ok ? ((await r.json()) as { servers?: Link[] }) : null;
  } catch {
    return null;
  }
}

/** What the open field adds: another server, or another account on a server already linked. */
type Adding = { what: "server" | "account"; text: string };

export function SyncServers({
  always = false,
}: {
  /** Drawn with no link yet, for the machine's local user, who adds the first one here. */
  always?: boolean;
}) {
  const [links, setLinks] = useState<Link[]>([]);
  const reload = useCallback(() => {
    void remote("GET").then((r) => setLinks(r?.servers ?? []));
  }, []);
  useEffect(reload, [reload]);

  // The field for another server or account: null while closed.
  const [adding, setAdding] = useState<Adding | null>(null);
  const valid = adding !== null && normalizeServer(adding.text) !== null;
  const add = async () => {
    if (adding === null || !valid) return;
    const bridge = accountBridge();
    const asked =
      adding.what === "account"
        ? await bridge?.addAccount?.(adding.text)
        : await bridge?.addServer?.(adding.text);
    setAdding(null);
    // The pairing finishes in the browser: the list grows when it has.
    if (asked) setTimeout(reload, AFTER_ADD_MS);
  };

  const makeMain = (l: Link) =>
    void remote("POST", "/main", { id: l.id }).then(reload);
  const forget = async (l: Link) => {
    const server = linkLabel(l);
    if (
      !(await askConfirm({
        title: m["account.removeServerTitle"]({ server }),
        body: m["account.removeServerBody"](),
        confirmLabel: m["common.remove"](),
        danger: true,
      }))
    )
      return;
    await remote("DELETE", `?id=${encodeURIComponent(l.id)}`);
    reload();
  };

  if (!links.length && !always) return null;
  // Where the server itself is listed, it is the main one for good.
  const fixedMain = links.some((l) => l.own);
  // Another account goes on a server already linked: the main one's, which the field starts with.
  const remoteLinks = links.filter((l) => !l.own);
  const button =
    "rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground";
  const opener = (what: Adding["what"]) =>
    setAdding({
      what,
      text: what === "account" ? hostLabel(remoteLinks[0]?.origin ?? "") : "",
    });
  const addLabel =
    adding?.what === "account"
      ? m["account.addAccount"]()
      : m["account.addServer"]();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {links.length > 0 && <span>{m["account.servers"]()}</span>}
      {links.map((l) => (
        <span
          key={l.id}
          className="flex min-w-0 items-center gap-1 rounded-md bg-secondary/60 px-2 py-0.5"
        >
          <span className="truncate text-foreground" title={linkLabel(l)}>
            {linkLabel(l)}
          </span>
          {l.main ? (
            <span className="text-primary-text">{m["account.main"]()}</span>
          ) : (
            <>
              {!fixedMain && (
                <button
                  type="button"
                  className={button}
                  title={m["account.makeMain"]()}
                  aria-label={m["account.makeMain"]()}
                  onClick={() => makeMain(l)}
                >
                  <Star className="size-3" />
                </button>
              )}
              <button
                type="button"
                className={button}
                title={m["account.removeServer"]({ server: linkLabel(l) })}
                aria-label={m["account.removeServer"]({
                  server: linkLabel(l),
                })}
                onClick={() => void forget(l)}
              >
                <X className="size-3" />
              </button>
            </>
          )}
        </span>
      ))}
      {adding === null ? (
        <>
          {accountBridge()?.addServer && (
            <button
              type="button"
              className={`${button} flex items-center gap-1 px-1.5`}
              title={m["account.addServerHint"]()}
              onClick={() => opener("server")}
            >
              <Plus className="size-3" /> {m["account.addServer"]()}
            </button>
          )}
          {accountBridge()?.addAccount && remoteLinks.length > 0 && (
            <button
              type="button"
              className={`${button} flex items-center gap-1 px-1.5`}
              title={m["account.addAccountHint"]()}
              onClick={() => opener("account")}
            >
              <UserPlus className="size-3" /> {m["account.addAccount"]()}
            </button>
          )}
        </>
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
            className={`w-44 rounded-md border bg-secondary px-2 py-0.5 text-xs outline-none focus:border-primary ${valid || !adding.text ? "border-border" : "border-red-400"}`}
            value={adding.text}
            onChange={(e) => setAdding({ ...adding, text: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setAdding(null)}
            placeholder="k7.example.org"
            aria-label={addLabel}
            spellCheck={false}
          />
          <button
            type="submit"
            className={button}
            disabled={!valid}
            aria-label={addLabel}
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setAdding(null)}
            aria-label={m["common.cancel"]()}
          >
            <X className="size-3.5" />
          </button>
        </form>
      )}
    </div>
  );
}
