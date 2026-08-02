import { Button } from "@frediverse/ui/button";
import { Card, CardContent } from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { login } from "../lib/auth";

// Full-screen OIDC gate, styled with @frediverse/ui like the rest of the
// network's apps (calepin, routine, …) rather than obscura-shared's
// terminal-look LoginGate — that shared component still backs the other five
// obscura frontends, which keep their own retro identity.
export function LoginGate({
  title = "OBSCURA",
  message,
  loginLabel = "LOGIN",
}: {
  title?: string;
  message?: string;
  loginLabel?: string;
}) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-5 py-4 text-center">
          <FrediverseMark size="lg" />
          <div
            className="text-2xl font-normal tracking-wide"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </div>
          {message && <p className="text-sm text-destructive">{message}</p>}
          <Button size="lg" className="w-full" onClick={login}>
            {loginLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
