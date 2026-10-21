// AccountButton.tsx — the account control at the top of the home page, wherever this machine runs its own backend:
// who is signed in, and the one button that signs in or out. Signing in asks which k7 server to sync with, in a popin.
// In a browser the page signs in itself (./browserAccount.ts); a phone app catches `/auth/login`. See ../../docs/localApp.md.

import { LogIn, LogOut } from "@frediverse/ui/icons";
import { STUDIO_ORIGIN } from "@studio/web-protocol/services";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { accountBridge, inAndroidApp } from "./bridge";
import { ServerDialog } from "./ServerDialog";

export interface Me {
  name?: string;
  email?: string | null;
  /** The machine's signed-out user, minted by its own backend. */
  local?: boolean;
}

const PHONE_SERVER_KEY = "k7.syncServer";

/** The server a phone last signed in with; only a prefill, the phone app keeping the one it pairs with. */
function phoneServer(): string {
  try {
    return localStorage.getItem(PHONE_SERVER_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The phone app opens the system browser on any navigation to `/auth/login`, and keeps its `server` for pairing. */
function phoneSignIn(server: string): void {
  try {
    localStorage.setItem(PHONE_SERVER_KEY, server);
  } catch {
    // A prefill lost, nothing more.
  }
  const returnTo = encodeURIComponent(location.pathname + location.search);
  location.assign(
    `/auth/login?return_to=${returnTo}&server=${encodeURIComponent(server)}`,
  );
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

/** Who is signed in, asked on mount: a sign-in and a sign-out both reload the page. */
export function AccountButton({
  onUser,
}: {
  /** Told who is signed in each time it is asked — the bar around it words the local user. */
  onUser?: (me: Me | null) => void;
}) {
  const [me, setMe] = useState<Me | null>(null);
  // Asked once: a sign-in and a sign-out both reload the page, which mounts this again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `onUser` is the parent's, told once per mount.
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
  }, []);

  // The last server chosen, prefilling the popin: kept by this page, in a browser or a phone.
  const [asking, setAsking] = useState(false);
  const [current, setCurrent] = useState<string>("");
  useEffect(() => {
    if (inAndroidApp()) return setCurrent(phoneServer());
    void accountBridge()
      ?.server?.()
      .then((s) => setCurrent(s ?? ""))
      .catch(() => {});
  }, []);
  const submit = (server: string) => {
    setAsking(false);
    setCurrent(server);
    if (inAndroidApp()) return phoneSignIn(server);
    accountBridge()?.signIn(server);
  };

  const signedIn = me !== null && !me.local;
  const name = signedIn ? me.name || me.email || "" : "";
  const button =
    "flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-secondary/50 hover:text-foreground";

  if (!signedIn)
    return (
      <>
        <button
          type="button"
          className={button}
          onClick={() => setAsking(true)}
          title={m["account.signInAccount"]()}
          aria-label={m["auth.signIn"]()}
        >
          <LogIn className="size-3.5" />
        </button>
        <ServerDialog
          open={asking}
          initial={current || STUDIO_ORIGIN}
          onClose={() => setAsking(false)}
          onSubmit={submit}
        />
      </>
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
      {/* A reload after the logout: AuthGate finds nobody and falls back to the machine's local user. */}
      <button
        type="button"
        className={button}
        onClick={() =>
          void fetch("/auth/logout", { method: "POST" })
            .catch(() => {})
            .then(() => location.reload())
        }
        title={m["account.signOut"]()}
        aria-label={m["account.signOut"]()}
      >
        <LogOut className="size-3.5" />
      </button>
    </div>
  );
}
