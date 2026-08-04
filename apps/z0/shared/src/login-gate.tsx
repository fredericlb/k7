import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";

// Full-screen OIDC gate (port of shared/components/LoginGate.vue). The
// @frediverse/ui Button supplies behavior/focus handling; the retro styling comes
// from the ported .login-* classes.
//
// The editor and buzzer deliberately don't use this: the editor renders a
// plain <button> its blue/grey .login-btn styles depend on, and the buzzer's
// gate is a guest-join form rather than a single login action.
export function LoginGate({
  onLogin,
  title = "BLIND-TEST",
  message,
  loginLabel = "LOGIN",
}: {
  onLogin: () => void;
  title?: string;
  message?: string;
  loginLabel?: string;
}) {
  return (
    <div className="login-gate">
      <div className="login-card">
        <div className="login-title">{title}</div>
        {message && <div className="login-msg">{message}</div>}
        <Button variant="outline" className="login-btn" onClick={onLogin}>
          <FrediverseMark size="sm" />
          {loginLabel}
        </Button>
      </div>
    </div>
  );
}
