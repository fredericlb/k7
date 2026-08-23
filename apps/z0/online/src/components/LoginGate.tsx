import { Button } from "@frediverse/ui/button";
import { Card, CardContent } from "@frediverse/ui/card";
import { FrediverseMark } from "@frediverse/ui/frediverse-mark";
import { login } from "../lib/auth";

// Styled with @frediverse/ui; the other five keep z0-shared's terminal-look gate on purpose.
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
