// AccountStatusNote.tsx — beside the account button: a sign-in or a pairing waiting on the browser, with Cancel, an offer to
// pair after a sign-in, or how it ended. The wording is here, in the person's language. See ../../docs/localApp.md.

import { X } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { m } from "../paraglide/messages.js";
import { type AccountStatus, accountBridge } from "./bridge";

/** How long an ending stays on screen before the bar is quiet again. */
const SHOWN_MS = 8_000;

function words(s: AccountStatus): string | null {
  const detail = "detail" in s ? (s.detail ?? "") : "";
  if (s.state === "offer")
    return m["account.status.offerPair"]({ server: new URL(s.server).host });
  if (s.state === "waiting")
    return s.what === "pair"
      ? m["account.status.waitingPair"]()
      : m["account.status.waitingSignIn"]();
  if (s.state === "done")
    return s.code === "paired"
      ? m["account.status.paired"]({ server: detail })
      : m["account.status.signedIn"]();
  if (s.state !== "error") return null;
  switch (s.code) {
    case "badServer":
      return m["account.status.badServer"]({ server: detail });
    case "signInTimeout":
      return m["account.status.signInTimeout"]();
    case "pairTimeout":
      return m["account.status.pairTimeout"]();
    case "alreadyLinked":
      return m["account.status.alreadyLinked"]({
        server: detail,
        as: s.as ?? "",
        local: s.local ?? "",
      });
    case "pairNotStored":
      return m["account.status.pairNotStored"]();
    default:
      return m["account.status.failed"]();
  }
}

export function AccountStatusNote() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  useEffect(() => {
    const bridge = accountBridge();
    void bridge
      ?.authStatus?.()
      .then((s) => s && setStatus((now) => now ?? s))
      .catch(() => {});
    return bridge?.onAuthStatus?.(setStatus);
  }, []);
  // An ending fades on its own; a wait stays until it ends or is cancelled.
  useEffect(() => {
    if (status?.state !== "done" && status?.state !== "error") return;
    const t = setTimeout(() => setStatus(null), SHOWN_MS);
    return () => clearTimeout(t);
  }, [status]);

  const text = status && words(status);
  if (!status || !text) return null;
  return (
    <span
      className={`flex min-w-0 items-center gap-1 text-xs ${status.state === "error" ? "text-red-400" : "text-muted-foreground"}`}
      role="status"
    >
      <span className="truncate" title={text}>
        {text}
      </span>
      {status.state === "offer" && (
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-foreground hover:bg-secondary/50"
          onClick={() => void accountBridge()?.pair?.(status.server)}
        >
          {m["account.status.pair"]()}
        </button>
      )}
      {status.state === "waiting" && (
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-secondary/50 hover:text-foreground"
          onClick={() => accountBridge()?.cancelSignIn?.()}
        >
          <X className="size-3" />
          {m["account.status.cancel"]()}
        </button>
      )}
    </span>
  );
}
