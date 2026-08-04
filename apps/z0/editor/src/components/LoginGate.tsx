import { FrediverseMark } from "@frediverse/ui/frediverse-mark";

import { login } from "../lib/auth";

// The editor keeps its own plain-UI gate (blue/grey), not the synthwave one
// the game surfaces share. Title is fixed, as it was in the Vue component.
export function LoginGate({ message }: { message?: string }) {
  return (
    <div className="login-gate">
      <div className="login-card">
        <h1 className="login-title">Session Editor</h1>
        {message && <p className="login-msg">{message}</p>}
        <button
          className="login-btn inline-flex items-center gap-2"
          onClick={login}
        >
          <FrediverseMark size="sm" />
          Sign in
        </button>
      </div>
    </div>
  );
}
