import { LoginGate as SharedLoginGate } from "z0-shared/login-gate";
import { login } from "../lib/auth";

// Wires this app's login action to the shared sign-in screen.
export function LoginGate(props: {
  title?: string;
  message?: string;
  loginLabel?: string;
}) {
  return <SharedLoginGate onLogin={login} {...props} />;
}
