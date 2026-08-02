import { AuthBadge } from "./components/AuthBadge";
import { LoginGate } from "./components/LoginGate";
import { useAuth } from "./lib/auth";
import { MonitorView } from "./views/MonitorView";

export default function App() {
  const { status, error, user } = useAuth();

  if (status === "unauthenticated") return <LoginGate />;
  if (status === "error") return <LoginGate message={error || "auth error"} />;
  if (status === "loading") return <div className="auth-loading">…</div>;
  if (!user?.isAdmin) {
    return (
      <div className="auth-loading forbidden">
        ACCESS DENIED — admin only
        <AuthBadge />
      </div>
    );
  }
  return <MonitorView />;
}
