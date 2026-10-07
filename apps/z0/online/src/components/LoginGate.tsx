import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { SignInScreen } from "@frediverse/ui/sign-in-screen";
import { login } from "../lib/auth";

// The apex app's sign-in, on commons' screen like every app's.
export function LoginGate({
  title = "Z0",
  message,
  loginLabel = "LOGIN",
}: {
  title?: string;
  message?: string;
  loginLabel?: string;
}) {
  return (
    <SignInScreen title={title} description={message} className="text-center">
      <Button size="lg" className="w-full" onClick={login}>
        <FrediverseMark size="sm" />
        {loginLabel}
      </Button>
    </SignInScreen>
  );
}
