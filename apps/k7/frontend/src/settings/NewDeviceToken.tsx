// NewDeviceToken.tsx — mints a device token of this account on the origin, for a machine that pairs by no browser:
// a command-line engine or a server's container, which sends it as STUDIO_DEVICE_TOKEN. The token is shown once:
// it is signed, not stored, so the origin cannot show it again. See ../../docs/settings.md.

import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { Action, Row } from "./Section";

export function NewDeviceToken({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    void fetch("/api/sync/devices", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: n }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        const r = (await res.json()) as { token: string };
        setToken(r.token);
        setCopied(false);
        setName("");
        onCreated();
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    if (!token) return;
    void navigator.clipboard
      ?.writeText(token)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };

  return (
    <>
      <form
        className="flex items-center gap-2 px-4 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          type="text"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={m["syncdev.tokenName"]()}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 text-sm"
        />
        <Action onClick={create} disabled={busy || !name.trim()}>
          {m["syncdev.createToken"]()}
        </Action>
      </form>
      {token && (
        <>
          <div className="flex items-center gap-2 px-4 py-2.5">
            <input
              readOnly
              value={token}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-neutral-200 text-xs"
            />
            <Action onClick={copy}>
              {copied ? m["syncdev.copied"]() : m["syncdev.copy"]()}
            </Action>
            <Action onClick={() => setToken(null)}>
              {m["syncdev.done"]()}
            </Action>
          </div>
          <p className="px-4 py-2 text-faint text-xs">
            {m["syncdev.tokenOnce"]()}
          </p>
        </>
      )}
      {error && <Row label={m["syncdev.failed"]({ error })} />}
    </>
  );
}
