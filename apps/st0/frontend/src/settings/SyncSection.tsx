// SyncSection.tsx — the deploy key, which is what lets a repository be cloned and pushed at
// all. It is MADE on the machine and never leaves it, so this screen needs a machine and there
// is one key per machine rather than one per account.
// See packages/git-repos/docs/keys.md and ../../docs/settings.md.

import { TriangleAlert } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { engineMachine, type Machine } from "../projects/api";
import { probeMachine } from "./machine";
import { Action, Row, Section } from "./Section";

export function SyncSection() {
  const [key, setKey] = useState<string | null>(null);
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same probe the home page runs: this screen reads a machine's disk, not an account's record.
  useEffect(() => {
    void probeMachine().then((m) => {
      setMachine(m);
      if (!m) return;
      void engineMachine
        .sshKey(m)
        .then((r) => setKey(r.publicKey))
        .catch((e: Error) => setError(e.message));
    });
  }, []);

  const generate = () => {
    if (!machine) return;
    setBusy(true);
    setError(null);
    void engineMachine
      .createSshKey(machine)
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
      hint="Add this public key at your git host — as a deploy key, or as an account SSH key — before adding a repository. It is made on the machine and never leaves it, so each machine has its own to register."
    >
      {machine === null ? (
        <Row
          label="No machine"
          detail="The key lives on the machine that clones, so there is one to read only when one answers."
        />
      ) : key ? (
        <>
          <Row
            label="Your key is ready"
            detail="One per machine, pasted once at the host."
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
