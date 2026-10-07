import { Button } from "@frediverse/ui/button";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { SignInScreen } from "@frediverse/ui/sign-in-screen";

// The game's sign-in, on commons' screen like every app's; the buzzer adds its join form to the same screen.
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
    <SignInScreen title={title} description={message} className="text-center">
      <Button className="w-full" onClick={onLogin}>
        <FrediverseMark size="sm" />
        {loginLabel}
      </Button>
    </SignInScreen>
  );
}
