import { Alert, AlertDescription, AlertTitle } from "@frediverse/ui/alert";
import { Loader2, ShieldAlert } from "@frediverse/ui/icons";
import { AccountMenu } from "./components/AccountMenu";
import { Game2D } from "./components/Game2D";
import { LoginGate } from "./components/LoginGate";
import { useAuth } from "./lib/auth";

export default function App() {
  const { status, error, user } = useAuth();

  if (status === "authenticated" && user?.isAdmin) {
    return (
      <>
        <Game2D />
        <div className="fixed top-2 right-2 z-50">
          <AccountMenu />
        </div>
      </>
    );
  }
  if (status === "authenticated") {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-background p-4">
        <Alert variant="destructive" className="max-w-sm">
          <ShieldAlert />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>The presenter is for admins only.</AlertDescription>
        </Alert>
        <AccountMenu />
      </div>
    );
  }
  if (status === "unauthenticated") return <LoginGate />;
  if (status === "error") return <LoginGate message={error || "auth error"} />;
  return (
    <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
      <Loader2 className="size-6 animate-spin" aria-label="loading" />
    </div>
  );
}
