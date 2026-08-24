// Username badge + optional logout, the terminal-styled one the game SPAs share.
// The .auth-* classes are themed per app, so the presenter's fixed synthwave
// badge and the editor's inline blue/grey one are this same markup.

export interface AuthBadgeUser {
  name?: string;
  email?: string;
}

export function AuthBadge({
  user,
  onLogout,
  logoutLabel = "LOGOUT",
  showLogout = true,
}: {
  user: AuthBadgeUser | null | undefined;
  onLogout: () => void;
  logoutLabel?: string;
  showLogout?: boolean;
}) {
  if (!user) return null;
  const label = user.name || user.email || "?";
  return (
    <div className="auth-badge">
      <svg viewBox="0 0 24 24" className="auth-user-icon" aria-hidden="true">
        <path
          d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.42 0-8 2.69-8 6v2h16v-2c0-3.31-3.58-6-8-6z"
          fill="currentColor"
        />
      </svg>
      <span className="auth-name">{label}</span>
      {showLogout && (
        <button
          className="auth-logout"
          title={logoutLabel}
          aria-label={logoutLabel}
          onClick={onLogout}
        >
          <svg
            viewBox="0 0 24 24"
            className="auth-logout-icon"
            aria-hidden="true"
          >
            <path
              d="M16 17l5-5-5-5M21 12H9M12 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
