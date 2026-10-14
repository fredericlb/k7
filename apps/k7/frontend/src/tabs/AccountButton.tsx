// AccountButton.tsx — the right end of the title bar: who is signed in, and the one button that signs in or out.
// Signing in asks which k7 server to sync with, inline: the strip is a thin view, and a popover would be clipped.
// Signing in happens in the system browser, through the main process; signing out is the origin's own logout. See apps/k7-standalone/docs/signIn.md.

import { LogIn, LogOut, X } from "@frediverse/ui/icons";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { useEffect, useState } from "react";
import { type TabRow, tabsBridge } from "./bridge";

interface Me {
  name?: string;
  email?: string | null;
  /** The desktop's signed-out user, minted by its own backend. */
  local?: boolean;
}

async function whoami(): Promise<Me | null> {
  try {
    const res = await fetch("/auth/me", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { user: Me }).user;
  } catch {
    return null;
  }
}

/** Asked again whenever the tabs change: a sign-in or out is always a navigation of one of them. */
export function AccountButton({ rows }: { rows: TabRow[] }) {
  const [me, setMe] = useState<Me | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows changing IS the signal.
  useEffect(() => {
    let live = true;
    void whoami().then((m) => {
      if (live) setMe(m);
    });
    return () => {
      live = false;
    };
  }, [rows]);

  // The server field: null while closed, else what is typed; prefilled with the last choice.
  const [server, setServer] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>("");
  useEffect(() => {
    void tabsBridge()
      ?.server?.()
      .then((s) => setCurrent(s ?? ""))
      .catch(() => {});
  }, []);
  const valid = server !== null && normalizeServer(server) !== null;
  const submit = () => {
    if (server === null || !valid) return;
    tabsBridge()?.signIn(server);
    setCurrent(normalizeServer(server) ?? current);
    setServer(null);
  };

  const signedIn = me !== null && !me.local;
  const name = signedIn ? me.name || me.email || "" : "";
  const button =
    "flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-secondary/50 hover:text-foreground";

  if (!signedIn && server !== null)
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: the field exists only because the person just asked for it.
          autoFocus
          className={`w-48 rounded-md border bg-secondary px-2 py-0.5 text-xs outline-none focus:border-primary ${valid || !server ? "border-border" : "border-red-400"}`}
          value={server}
          onChange={(e) => setServer(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setServer(null)}
          placeholder="st0.app"
          aria-label="k7 server"
          title="The k7 server this machine syncs your workspaces with"
          spellCheck={false}
        />
        <button
          type="submit"
          className={button}
          disabled={!valid}
          title="Sign in, and sync with this server"
          aria-label="Sign in"
        >
          <LogIn className="size-3.5" />
        </button>
        <button
          type="button"
          className={button}
          onClick={() => setServer(null)}
          title="Cancel"
          aria-label="Cancel"
        >
          <X className="size-3.5" />
        </button>
      </form>
    );
  if (!signedIn)
    return (
      <button
        type="button"
        className={button}
        onClick={() =>
          tabsBridge()?.server
            ? setServer(current.replace(/^https:\/\//, ""))
            : tabsBridge()?.signIn()
        }
        title="Sign in with your k7 account"
        aria-label="Sign in"
      >
        <LogIn className="size-3.5" />
      </button>
    );
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span
        className="max-w-48 truncate text-xs"
        title={[me.email, current && `syncs with ${current}`]
          .filter(Boolean)
          .join(" — ")}
      >
        {name}
      </span>
      {/* The cookie going is what the main process watches: it falls back to the local user. */}
      <button
        type="button"
        className={button}
        onClick={() =>
          void fetch("/auth/logout", { method: "POST" }).catch(() => {})
        }
        title="Sign out"
        aria-label="Sign out"
      >
        <LogOut className="size-3.5" />
      </button>
    </div>
  );
}
