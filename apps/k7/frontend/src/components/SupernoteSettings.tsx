// The Supernote sync, on the settings screen: a toggle, the three things the private
// cloud needs to let us in, and what the last run did.
//
// It polls while a run is going: the activation and the force button both start one and
// answer straight away, because a whole songbook does not fit in a request.
// The reasoning behind the sync itself is in ../../../docs/supernote.md.

import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import { Label } from "@frediverse/ui/label";
import { Switch } from "@frediverse/ui/switch";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { SupernoteSync } from "../types";

const POLL_MS = 2000;

/** A date a musician can read, in the browser's own locale. */
function fmtSync(iso: string): string {
  if (!iso) return "never";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

export function SupernoteSettings() {
  const [state, setState] = useState<SupernoteSync | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The toggle answers before the server does, so the fields appear on the click.
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable, so the two effects below depend on the state and not on a new closure.
  const apply = useCallback((next: SupernoteSync) => {
    setState(next);
    setOpen(next.enabled);
    if (next.baseUrl) setBaseUrl(next.baseUrl);
    if (next.account) setAccount(next.account);
  }, []);

  useEffect(() => {
    api
      .supernoteStatus()
      .then(apply)
      .catch(() => {});
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [apply]);

  // While a run is going the screen follows it, and stops asking the moment it ends.
  useEffect(() => {
    if (!state?.syncing) return;
    timer.current = setTimeout(() => {
      api
        .supernoteStatus()
        .then(apply)
        .catch(() => {});
    }, POLL_MS);
  }, [state, apply]);

  const guard = async (act: () => Promise<SupernoteSync>) => {
    setBusy(true);
    setError(null);
    try {
      apply(await act());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (on: boolean) => {
    setOpen(on);
    setError(null);
    if (!on && state?.activated) void guard(api.disableSupernote);
  };

  const activate = () =>
    guard(() => api.activateSupernote({ baseUrl, account, password })).then(
      () => setPassword(""),
    );

  return (
    <>
      <div className="supernote-head">
        <div>
          <div className="settings-title muted small">Supernote sync</div>
          <p className="muted small">
            One EPUB per song, pushed to <code>Document/Songbook</code> on your
            own private cloud, then once an hour.
          </p>
        </div>
        <Switch
          checked={open}
          onCheckedChange={toggle}
          aria-label="Synchroniser Supernote"
        />
      </div>

      {open && (
        <div className="supernote-form">
          <Label htmlFor="sn-url">Address</Label>
          <Input
            id="sn-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://media.example.com/priv/supernote"
          />
          <Label htmlFor="sn-account">Account</Label>
          <Input
            id="sn-account"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            placeholder="you@example.com"
          />
          <Label htmlFor="sn-password">Password</Label>
          <Input
            id="sn-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={state?.activated ? "•••••••• (on file)" : ""}
          />

          <div className="row" style={{ marginTop: 8 }}>
            <Button
              disabled={busy || !baseUrl || !account || !password}
              onClick={activate}
            >
              {busy ? "Checking…" : "Activer la synchronisation"}
            </Button>
            {state?.activated && (
              <Button
                variant="outline"
                disabled={busy || state.syncing}
                onClick={() => guard(api.syncSupernote)}
              >
                {state.syncing ? "Syncing…" : "Sync now"}
              </Button>
            )}
          </div>

          {state?.activated && (
            <p className="muted small" style={{ marginTop: 8 }}>
              Last sync: {fmtSync(state.lastSyncAt)}
              {state.lastStatus && state.lastStatus !== "ok"
                ? ` — ${state.lastStatus}`
                : state.lastCount
                  ? ` — ${state.lastCount} pushed`
                  : ""}
            </p>
          )}
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </>
  );
}
