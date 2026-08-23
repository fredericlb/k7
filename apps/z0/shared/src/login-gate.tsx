import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";

// The editor and buzzer do NOT use this: one needs its own styles, the other a guest-join form.
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
