import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { Input } from "@frediverse/ui/input";
import { type FormEvent, useState } from "react";
import { login, loginAsGuest, useAuth } from "../lib/auth";

export const NAME_KEY = "buzzer_player_name";
export const NAME_CONFIRMED_KEY = "buzzer_name_confirmed";

// Entry gate (port of the buzzer's LoginGate.vue). JOIN behaviour depends on
// auth state: authenticated → persist the name and continue; unauthenticated
// + guestEnabled + password → guest-login with name+password.
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
    <div className="login-gate">
      <div className="login-card">
        <div className="login-title">BLIND-TEST</div>
        {message && <div className="login-msg">{message}</div>}

        {!isAuthenticated && (
          <>
            <Button
              variant="outline"
              className="login-btn"
              onClick={handleLogin}
            >
              <FrediverseMark size="sm" />
              LOGIN
            </Button>
            {guestEnabled && (
              <>
                <div className="divider">
                  <span>OR GUEST</span>
                </div>
                <Input
                  className="guest-input"
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
          className={`name-form${!isAuthenticated ? " name-form-separated" : ""}`}
          onSubmit={submitJoin}
        >
          <Input
            className="guest-input name-input"
            type="text"
            placeholder="YOUR NAME"
            autoComplete="off"
            maxLength={12}
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <Button
            variant="outline"
            className="guest-btn"
            type="submit"
            disabled={!canJoin}
          >
            {joinLabel}
          </Button>
        </form>

        {error && <div className="guest-error">{error}</div>}
      </div>
    </div>
  );
}
