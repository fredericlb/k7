import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Input } from "@frediverse/ui/input";
import { SignInScreen } from "@frediverse/ui/sign-in-screen";
import { type FormEvent, useState } from "react";
import { login, loginAsGuest, useAuth } from "../lib/auth";

export const NAME_KEY = "buzzer_player_name";
export const NAME_CONFIRMED_KEY = "buzzer_name_confirmed";

// JOIN keeps the name for an account, and guest-logs in with name plus password otherwise.
export function LoginGate({ message }: { message?: string }) {
  const { status: authStatus, guestEnabled, registrationOpen } = useAuth();
  const [playerName, setPlayerName] = useState(
    localStorage.getItem(NAME_KEY) || "",
  );
  const [guestPassword, setGuestPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isAuthenticated = authStatus === "authenticated";
  const trimmedName = playerName.trim();

  const canJoin =
    !submitting &&
    !!trimmedName &&
    registrationOpen &&
    (isAuthenticated || (guestEnabled && !!guestPassword));

  const joinLabel = submitting
    ? "..."
    : !registrationOpen
      ? "REGISTRATION CLOSED"
      : "JOIN";

  function persistName() {
    localStorage.setItem(NAME_KEY, trimmedName);
  }

  function handleLogin() {
    // Save the name if already typed — saves a second prompt on OIDC return.
    if (trimmedName) persistName();
    login();
  }

  async function submitJoin(e: FormEvent) {
    e.preventDefault();
    if (!canJoin) return;
    setError(null);
    persistName();
    // Per-tab confirmation so within-session reloads don't re-prompt.
    sessionStorage.setItem(NAME_CONFIRMED_KEY, "1");
    if (isAuthenticated) {
      window.location.reload();
      return;
    }
    setSubmitting(true);
    const err = await loginAsGuest(guestPassword, trimmedName);
    if (err) {
      setError(err);
      setSubmitting(false);
    }
    // success → page reloads
  }

  return (
    <SignInScreen
      title="BLIND-TEST"
      description={message}
      className="text-center"
    >
      <div className="flex flex-col gap-3">
        {!isAuthenticated && (
          <>
            <Button className="w-full" onClick={handleLogin}>
              <FrediverseMark size="sm" />
              LOGIN
            </Button>
            {guestEnabled && (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  OR GUEST
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Input
                  type="password"
                  placeholder="PASSWORD"
                  autoComplete="current-password"
                  value={guestPassword}
                  onChange={(e) => setGuestPassword(e.target.value)}
                />
              </>
            )}
          </>
        )}

        <form
          className={`flex gap-2${!isAuthenticated ? " mt-2 border-t pt-4" : ""}`}
          onSubmit={submitJoin}
        >
          <Input
            className="flex-1"
            type="text"
            placeholder="YOUR NAME"
            autoComplete="off"
            maxLength={12}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <Button variant="outline" type="submit" disabled={!canJoin}>
            {joinLabel}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </SignInScreen>
  );
}
