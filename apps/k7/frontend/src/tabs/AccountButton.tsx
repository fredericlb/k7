// AccountButton.tsx — the desktop app's account control, at the top of the home page: who is signed in, and the one button that signs in or out.
// Signing in asks which k7 server to sync with, inline, beside the button that asked.
// Signing in happens in the system browser — the desktop's main process, or the phone app catching `/auth/login`; signing out is the origin's own logout.
// See apps/k7-standalone/docs/signIn.md and engine/k7-runtime/docs/android.md.

import { LogIn, LogOut, X } from "@frediverse/ui/icons";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { inAndroidApp, tabsBridge } from "./bridge";

export interface Me {
  name?: string;
  email?: string | null;
  /** The desktop's signed-out user, minted by its own backend. */
  local?: boolean;
}

/** The phone app opens the system browser on any navigation to `/auth/login`, so the page only has to go there. */
const androidSignIn = () =>
  location.assign(
    `/auth/login?return_to=${encodeURIComponent(location.pathname + location.search)}`,
  );

async function whoami(): Promise<Me | null> {
  try {
    const res = await fetch("/auth/me", { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { user: Me }).user;
  } catch {
    return null;
  }
}

/** Asked on mount and after a sign-out: a sign-in reloads the home page, which mounts this again. */
export function AccountButton({
  onUser,
}: {
  /** Told who is signed in each time it is asked — the bar around it words the local user. */
  onUser?: (me: Me | null) => void;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [asked, setAsked] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `asked` changing IS the signal.
  useEffect(() => {
    let live = true;
    void whoami().then((m) => {
      if (!live) return;
      setMe(m);
      onUser?.(m);
    });
    return () => {
      live = false;
    };
  }, [asked]);

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
          aria-label={m["account.serverLabel"]()}
          title={m["account.serverHint"]()}
          spellCheck={false}
        />
        <button
          type="submit"
          className={button}
          disabled={!valid}
          title={m["account.signInSync"]()}
          aria-label={m["auth.signIn"]()}
        >
          <LogIn className="size-3.5" />
        </button>
        <button
          type="button"
          className={button}
          onClick={() => setServer(null)}
          title={m["common.cancel"]()}
          aria-label={m["common.cancel"]()}
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
          inAndroidApp()
            ? androidSignIn()
            : tabsBridge()?.server
              ? setServer(current.replace(/^https:\/\//, ""))
              : tabsBridge()?.signIn()
        }
        title={m["account.signInAccount"]()}
        aria-label={m["auth.signIn"]()}
      >
        <LogIn className="size-3.5" />
      </button>
    );
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span
        className="max-w-48 truncate text-xs"
        title={[
          me.email,
          current && m["account.syncsWith"]({ server: current }),
        ]
          .filter(Boolean)
          .join(" — ")}
      >
        {name}
      </span>
      {/* The desktop's main process watches the cookie go; the phone hears it from the page's reload, and falls back to the local user. */}
      <button
        type="button"
        className={button}
        onClick={() =>
          void fetch("/auth/logout", { method: "POST" })
            .catch(() => {})
            .then(() =>
              inAndroidApp() ? location.reload() : setAsked((n) => n + 1),
            )
        }
        title={m["account.signOut"]()}
        aria-label={m["account.signOut"]()}
      >
        <LogOut className="size-3.5" />
      </button>
    </div>
  );
}
