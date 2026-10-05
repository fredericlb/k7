import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Check } from "@frediverse/ui/icons";
import { useState } from "react";
import { api } from "../api";
import { CleanUpSessions } from "../components/CleanUpSessions";
import { CodeText } from "../components/CodeText";
import { useLocale } from "../i18n";
import { m } from "../paraglide/messages.js";
import type { Locale } from "../paraglide/runtime.js";
import type { Session, User } from "../types";

// Each language named in itself, so whoever cannot read the current one still finds theirs.
const LANGUAGE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
};

interface Props {
  user: User;
  sessions: Session[];
  onLogout: () => void;
  onCleanSessions: (ids: string[]) => Promise<void>;
}

export function SettingsView({
  user,
  sessions,
  onLogout,
  onCleanSessions,
}: Props) {
  const { locale, locales, setLocale } = useLocale();
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
      <h2>{m["settings.title"]()}</h2>

      <Card>
        <div className="settings-title muted small">
          {m["settings.signedInAs"]()}
        </div>
        <div className="settings-user">{user.name}</div>
        {user.email && <div className="muted small">{user.email}</div>}
        <Button variant="outline" className="mt-4" onClick={onLogout}>
          {m["settings.signOut"]()}
        </Button>
      </Card>

      <Card className="mt-4">
        <label className="settings-title muted small" htmlFor="language">
          {m["settings.language"]()}
        </label>
        <p className="muted small">{m["settings.languageHelp"]()}</p>
        <select
          id="language"
          className="settings-language"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
        >
          {locales.map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_NAMES[l]}
            </option>
          ))}
        </select>
      </Card>

      <Card className="mt-4">
        <CleanUpSessions sessions={sessions} onClean={onCleanSessions} />
      </Card>

      <Card className="mt-4">
        <div className="settings-title muted small">
          {m["settings.token"]()}
        </div>
        <p className="muted small">
          <CodeText text={m["settings.tokenHelp"]()} />
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
                    {m["common.copied"]()} <Check className="size-4" />
                  </>
                ) : (
                  m["common.copy"]()
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={generate}>
                {m["settings.tokenRegenerate"]()}
              </Button>
            </div>
          </>
        ) : (
          <Button disabled={loading} onClick={generate}>
            {loading
              ? m["settings.tokenGenerating"]()
              : m["settings.tokenGenerate"]()}
          </Button>
        )}
      </Card>
    </div>
  );
}
