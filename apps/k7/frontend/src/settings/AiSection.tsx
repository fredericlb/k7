// AiSection.tsx — the account's Claude key and model, which the module builder's "AI organize"
// runs on. The key is stored by k7's backend for this account and is WRITE-ONLY from here:
// what comes back is a hint of it, never the key. See ../../docs/settings.md.

import { TriangleAlert } from "@frediverse/ui/icons";
import { useEffect, useState } from "react";
import { type AiSettingsView, aiOrganize } from "../api";
import { Action, Row, Section } from "./Section";

const FIELD =
  "w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-neutral-200 text-xs placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none";

export function AiSection() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void aiOrganize
      .settings()
      .then((v) => {
        setView(v);
        setModel(v.model ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const save = (patch: { apiKey?: string | null; model?: string | null }) => {
    setBusy(true);
    setError(null);
    void aiOrganize
      .saveSettings(patch)
      .then((v) => {
        setView(v);
        setModel(v.model ?? "");
        // The typed key is gone from the page once stored: the hint is all that stays on screen.
        if (patch.apiKey !== undefined) setKey("");
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const modelChanged = model.trim() !== (view?.model ?? "");

  return (
    <Section
      title="AI"
      hint="The Claude API key and model the module builder's AI organize uses. Stored on the server for your account; once saved, the key is never shown again."
    >
      <Row
        label={view?.keyHint ? `Key ${view.keyHint}` : "No key"}
        detail={
          view?.keyHint
            ? "AI organize is on in the module builder."
            : "Without one, the module builder shows no AI organize button."
        }
      >
        {view?.keyHint && (
          <Action danger disabled={busy} onClick={() => save({ apiKey: null })}>
            Remove
          </Action>
        )}
      </Row>
      <div className="flex gap-2 px-4 py-2.5">
        <input
          type="password"
          autoComplete="off"
          className={FIELD}
          placeholder={view?.keyHint ? "Replace with a new key" : "sk-ant-…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && key.trim()) save({ apiKey: key });
          }}
        />
        <Action
          disabled={busy || !key.trim()}
          onClick={() => save({ apiKey: key })}
        >
          Save
        </Action>
      </div>
      <div className="flex gap-2 px-4 py-2.5">
        <input
          className={FIELD}
          placeholder={view?.defaultModel ?? "model"}
          title="A Claude model id; empty uses the default"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && modelChanged)
              save({ model: model || null });
          }}
        />
        <Action
          disabled={busy || !modelChanged}
          onClick={() => save({ model: model || null })}
        >
          Save
        </Action>
      </div>
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
