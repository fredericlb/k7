import { AuthBadge } from "./components/AuthBadge";
import { Game2D } from "./components/Game2D";
import { LoginGate } from "./components/LoginGate";
import { useAuth } from "./lib/auth";

export default function App() {
  const { status, error, user } = useAuth();

  if (status === "authenticated" && user?.isAdmin) {
    return (
      <>
        <Game2D />
        <AuthBadge />
      </>
    );
  }
  if (status === "authenticated") {
    return (
      <div className="auth-loading auth-denied">
        ACCESS DENIED — admin only
        <AuthBadge />
      </div>
    );
  }
  if (status === "unauthenticated") return <LoginGate />;
  if (status === "error") return <LoginGate message={error || "auth error"} />;
  return <div className="auth-loading">…</div>;
}
