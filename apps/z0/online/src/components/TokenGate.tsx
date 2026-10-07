import { Alert, AlertDescription } from "@frediverse/ui/alert";
import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Input } from "@frediverse/ui/input";
import { SignInScreen } from "@frediverse/ui/sign-in-screen";
import { type FormEvent, useEffect, useState } from "react";
import { login } from "../lib/auth";
import {
  claimGuest,
  lookupGuest,
  readStoredGuestId,
  writeStoredGuestId,
} from "../lib/guest";
import { m } from "../paraglide/messages.js";

// The /t/<token> door: LOGIN goes through OIDC, GUEST claims a unique name with no account.
// A door before the app, so commons' SignInScreen; the session it opens is the description.
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
    <SignInScreen
      title={m["auth.appTitle"]()}
      description={sessionName}
      className="max-w-sm text-center"
    >
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
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
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
    </SignInScreen>
  );
}
