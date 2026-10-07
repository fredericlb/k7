import { Alert, AlertDescription, AlertTitle } from "@frediverse/ui/alert";
import { Loader2, ShieldAlert } from "@frediverse/ui/icons";
import { AccountMenu } from "./components/AccountMenu";
import { LoginGate } from "./components/LoginGate";
import { useAuth } from "./lib/auth";
import { MonitorView } from "./views/MonitorView";

export default function App() {
  const { status, error, user } = useAuth();

  if (status === "unauthenticated") return <LoginGate />;
  if (status === "error") return <LoginGate message={error || "auth error"} />;
  if (status === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="size-6 animate-spin" aria-label="loading" />
      </div>
    );
  }
  if (!user?.isAdmin) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-background p-4">
        <Alert variant="destructive" className="max-w-sm">
          <ShieldAlert />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>The monitor is for admins only.</AlertDescription>
        </Alert>
        <AccountMenu />
      </div>
    );
  }
  return <MonitorView />;
}
