// SyncSection.tsx — the deploy key, which is what lets a repository be cloned and pushed at
// all. It is MADE by the account's file service on the server and never leaves it, so this
// screen needs that service and no engine, and there is one key per account.
// See packages/git-repos/docs/keys.md and ../../docs/settings.md.

import { TriangleAlert } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { type AccountFiles, accountFiles } from "../projects/api";
import { findAccountFiles } from "./accountFiles";
import { Action, Row, Section } from "./Section";

export function SyncSection() {
  const [key, setKey] = useState<string | null>(null);
  const [fileService, setFileService] = useState<
    AccountFiles | null | undefined
  >(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same lookup the home page runs, engine or none: the key is the account's, on the server.
  useEffect(() => {
    void findAccountFiles(false).then((m) => {
      setFileService(m);
      if (!m) return;
      void accountFiles
        .sshKey(m)
        .then((r) => setKey(r.publicKey))
        .catch((e: Error) => setError(e.message));
    });
  }, []);

  const generate = () => {
    if (!fileService) return;
    setBusy(true);
    setError(null);
    void accountFiles
      .createSshKey(fileService)
      .then((r) => setKey(r.publicKey))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    if (!key) return;
    void navigator.clipboard.writeText(key).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Section
      title="Deploy key"
      hint="Add this public key at your git host — as a deploy key, or as an account SSH key — before adding a repository. It is made on the server for your account and never leaves it, so there is one to register."
    >
      {fileService === null ? (
        <Row
          label="No file service"
          detail="The key lives in your account's files on the server, which are not answering."
        />
      ) : key ? (
        <>
          <Row
            label="Your key is ready"
            detail="One per account, pasted once at the host."
          >
            <Action onClick={copy}>{copied ? "Copied" : "Copy"}</Action>
          </Row>
          {/* Outside the row: a Row truncates its label, and a key you can only see the start of is one you cannot check. */}
          <div className="px-4 py-2.5">
            <code className="block overflow-x-auto whitespace-pre rounded bg-neutral-950 px-2 py-1.5 font-mono text-neutral-400 text-xs">
              {key}
            </code>
          </div>
        </>
      ) : (
        <Row
          label="No key yet"
          detail="Nothing can be cloned until there is one."
        >
          <Action onClick={generate} disabled={busy}>
            {busy ? "Generating…" : "Generate"}
          </Action>
        </Row>
      )}
      {error && (
        <Row
          label={
            <>
              <TriangleAlert className="size-3.5" /> {error}
            </>
          }
        />
      )}
    </Section>
  );
}
