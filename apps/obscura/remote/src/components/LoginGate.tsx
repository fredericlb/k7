import { LoginGate as SharedLoginGate } from "obscura-shared/login-gate";
import { login } from "../lib/auth";

// Wires this app's login action to the shared synthwave gate.
export function LoginGate(props: {
  title?: string;
  message?: string;
  loginLabel?: string;
}) {
  return <SharedLoginGate onLogin={login} {...props} />;
}
