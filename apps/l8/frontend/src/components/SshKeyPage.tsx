// SshKeyPage.tsx — generate and show the SSH public key used to clone workspaces, reached
// from the workspace picker (there is no router; views are gate state). The key belongs to
// the ENGINE'S machine, one per user, because the clone runs on the file service — this
// page only ever sees the public half.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft, Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { m } from "../paraglide/messages.js";

export function SshKeyPage({ onBack }: { onBack: () => void }) {
  const [key, setKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .sshKey()
      .then(({ publicKey }) => {
        if (!cancelled) setKey(publicKey);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = () => {
    setBusy(true);
    setError(null);
    api
      .generateSshKey()
      .then(({ publicKey }) => setKey(publicKey))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    if (!key) return;
    void navigator.clipboard.writeText(key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex h-full items-center justify-center bg-background p-8 text-foreground">
      <div className="flex w-full max-w-lg flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <KeyRound className="h-5 w-5" /> {m["sshKey.title"]()}
          </h1>
          <Button variant="secondary" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> {m["sshKey.back"]()}
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">{m["sshKey.body"]()}</p>

        {loading ? (
          <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />{" "}
              {m["common.loading"]()}
            </span>
          </div>
        ) : key ? (
          <>
            <code className="max-w-full overflow-x-auto whitespace-pre rounded-md border border-border bg-secondary p-3 text-xs">
              {key}
            </code>
            <div>
              <Button variant="secondary" size="sm" onClick={copy}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4" /> {m["sshKey.copied"]()}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> {m["sshKey.copy"]()}
                  </>
                )}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-md border border-border p-6">
            <p className="text-sm text-muted-foreground">
              {m["sshKey.none"]()}
            </p>
            <Button size="sm" onClick={generate} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              {m["sshKey.generate"]()}
            </Button>
          </div>
        )}

        {error && (
          <code className="max-w-full overflow-x-auto rounded bg-muted px-2 py-1 text-xs text-red-400">
            {error}
          </code>
        )}
      </div>
    </div>
  );
}
