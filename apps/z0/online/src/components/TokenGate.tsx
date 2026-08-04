import { Button } from "@frediverse/ui/button";
import { Card, CardContent } from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Input } from "@frediverse/ui/input";
import { type FormEvent, useEffect, useState } from "react";
import { login } from "../lib/auth";
import {
  claimGuest,
  lookupGuest,
  readStoredGuestId,
  writeStoredGuestId,
} from "../lib/guest";
import { m } from "../paraglide/messages.js";

// Entry gate for unauthenticated /t/<token> visitors: LOGIN bounces through
// OIDC; GUEST claims a unique username without an account (pre-filled from
// the last localStorage UUID when known).
export function TokenGate({
  sessionName,
  onClaimed,
}: {
  sessionName: string;
  onClaimed: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "guest">("choose");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = readStoredGuestId();
    if (!id) return;
    let cancelled = false;
    void lookupGuest(id).then((found) => {
      if (found && !cancelled) setUsername(found.username);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (!name) {
      setError(m["token.invalid"]());
      return;
    }
    setSubmitting(true);
    setError("");
    const result = await claimGuest(name, readStoredGuestId());
    setSubmitting(false);
    if ("kind" in result) {
      if (result.kind === "conflict") setError(m["token.conflict"]());
      else if (result.kind === "invalid") setError(m["token.invalid"]());
      else setError(`${m["token.errorPrefix"]()} ${result.message}`);
      return;
    }
    writeStoredGuestId(result.guestId);
    onClaimed();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-5 py-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <div
              className="text-xl font-normal tracking-wide"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {m["auth.appTitle"]()}
            </div>
            <div
              className="w-full truncate rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted-foreground"
              title={sessionName}
            >
              {sessionName}
            </div>
          </div>

          {mode === "choose" ? (
            <div className="flex flex-col gap-2">
              <Button
                size="lg"
                onClick={() => {
                  setMode("guest");
                  setError("");
                }}
              >
                {m["token.guest"]()}
              </Button>
              <Button variant="outline" size="lg" onClick={login}>
                <FrediverseMark size="sm" />
                {m["token.login"]()}
              </Button>
            </div>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={submit}>
              <Input
                type="text"
                maxLength={32}
                autoComplete="nickname"
                placeholder={m["token.usernamePlaceholder"]()}
                disabled={submitting}
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() => {
                    setMode("choose");
                    setError("");
                  }}
                >
                  {m["token.cancel"]()}
                </Button>
                <Button type="submit" className="flex-1" disabled={submitting}>
                  {m["token.continue"]()}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
