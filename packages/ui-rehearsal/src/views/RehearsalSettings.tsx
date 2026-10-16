// RehearsalSettings.tsx — the rehearsal pages' section of the host's settings page: clearing empty
// sessions and the CLI token. The language and the account are the host's own sections.

import { AskHost } from "@frediverse/ui/ask";
import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import { Check } from "@frediverse/ui/icons";
import { useCallback, useEffect, useState } from "react";
import { type ApiToken, api } from "../api";
import { CleanUpSessions } from "../components/CleanUpSessions";
import { CodeText } from "../components/CodeText";
import { m } from "../paraglide/messages.js";
import type { Session } from "../types";
import "../styles/index.css";

export function RehearsalSettings() {
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    api
      .listSessions()
      .then(setSessions)
      .catch(() => {});
  }, []);
  const clean = async (ids: string[]) => {
    for (const id of ids) await api.deleteSession(id);
    setSessions(await api.listSessions());
  };
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [listed, setListed] = useState<ApiToken[]>([]);
  const refresh = useCallback(
    () =>
      api
        .listApiTokens()
        .then((r) => setListed(r.tokens))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const generate = async () => {
    setLoading(true);
    setCopied(false);
    try {
      const { token } = await api.createApiToken();
      setToken(token);
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (id: string) => {
    await api.revokeApiToken(id);
    await refresh();
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
    <div className="rehearsal-root settings">
      {/* The clean-up's confirmation is drawn here: the host's settings page mounts no host of this one. */}
      <AskHost />
      <h2>{m["settings.rehearsal"]()}</h2>

      <Card>
        <CleanUpSessions sessions={sessions} onClean={clean} />
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
        {listed.length > 0 && (
          <>
            <div
              className="settings-title muted small"
              style={{ marginTop: 16 }}
            >
              {m["settings.tokenList"]()}
            </div>
            {listed.map((t) => (
              <div key={t.id} className="row" style={{ marginTop: 8 }}>
                <span className="small">
                  {t.label} ·{" "}
                  {m["settings.tokenExpires"]({ date: day(t.expires) })} ·{" "}
                  {t.lastUsed
                    ? m["settings.tokenLastUsed"]({ date: day(t.lastUsed) })
                    : m["settings.tokenNeverUsed"]()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void revoke(t.id)}
                >
                  {m["settings.tokenRevoke"]()}
                </Button>
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}

const day = (ms: number): string => new Date(ms).toLocaleDateString();
