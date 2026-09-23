import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { ArrowLeft, Check } from "@frediverse/ui/icons";
import { useState } from "react";
import { api } from "../api";
import { CleanUpSessions } from "../components/CleanUpSessions";
import { SupernoteSettings } from "../components/SupernoteSettings";
import type { Session, User } from "../types";

interface Props {
  user: User;
  sessions: Session[];
  onLogout: () => void;
  onBack: () => void;
  onCleanSessions: (ids: string[]) => Promise<void>;
}

export function SettingsView({
  user,
  sessions,
  onLogout,
  onBack,
  onCleanSessions,
}: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setCopied(false);
    try {
      const { token } = await api.getApiToken();
      setToken(token);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      /* clipboard may be unavailable — the token is selectable in the field */
    }
  };

  return (
    <div className="settings">
      <Button variant="link" className="text-xs" onClick={onBack}>
        <ArrowLeft className="size-3.5" /> Back
      </Button>

      <h2>Settings</h2>

      <Card>
        <div className="settings-title muted small">Signed in as</div>
        <div className="settings-user">{user.name}</div>
        {user.email && <div className="muted small">{user.email}</div>}
        <Button variant="outline" className="mt-4" onClick={onLogout}>
          Sign out
        </Button>
      </Card>

      <Card className="mt-4">
        <CleanUpSessions sessions={sessions} onClean={onCleanSessions} />
      </Card>

      <Card className="mt-4">
        <SupernoteSettings />
      </Card>

      <Card className="mt-4">
        <div className="settings-title muted small">CLI access token</div>
        <p className="muted small">
          For the st0 <code>export</code> command. Add it to{" "}
          <code>~/.st0/config.json</code> as <code>k7Token</code> (or set{" "}
          <code>K7_TOKEN</code>). Anyone with this token can upload releases as
          you — keep it secret.
        </p>
        {token ? (
          <>
            <input
              className="token-field"
              readOnly
              value={token}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? (
                  <>
                    Copied <Check className="size-4" />
                  </>
                ) : (
                  "Copy"
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={generate}>
                Regenerate
              </Button>
            </div>
          </>
        ) : (
          <Button disabled={loading} onClick={generate}>
            {loading ? "Generating…" : "Generate token"}
          </Button>
        )}
      </Card>
    </div>
  );
}
