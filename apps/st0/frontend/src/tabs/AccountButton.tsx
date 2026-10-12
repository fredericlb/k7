// AccountButton.tsx — the right end of the title bar: who is signed in, and the one button that signs in or out.
// Signing in happens in the system browser, through the main process; signing out is the origin's own logout. See apps/st0-standalone/docs/signIn.md.

import { LogIn, LogOut } from "@frediverse/ui/icons";
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

  const signedIn = me !== null && !me.local;
  const name = signedIn ? me.name || me.email || "" : "";
  const button =
    "flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-secondary/50 hover:text-foreground";

  if (!signedIn)
    return (
      <button
        type="button"
        className={button}
        onClick={() => tabsBridge()?.signIn()}
        title="Sign in with your st0 account"
        aria-label="Sign in"
      >
        <LogIn className="size-3.5" />
      </button>
    );
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="max-w-48 truncate text-xs" title={me.email ?? undefined}>
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
