// ChainsSection.tsx — WHICH chains this machine separates a record with and makes an instrumental
// with. Standing answers for the MACHINE, not for a project: which module separates and which model
// it wants does not vary by set list, so they are st0's global settings rather than a tab of the
// editor. The choice is from the library's COLD chains only — a chain that does not separate
// could never answer either question. See ../../docs/settings.md.

import type { ColdChainsReply } from "@studio/web-protocol";
import { useEffect, useState } from "react";
import { parts } from "../i18nParts";
import { m } from "../paraglide/messages.js";
import { engineMachine, type Machine } from "../projects/api";
import { probeMachine } from "./machine";
import { Section } from "./Section";

type Which = "stems" | "instrumental";

function ChainPicker({
  label,
  none,
  body,
  value,
  options,
  disabled,
  onChoose,
}: {
  label: string;
  /** What the empty option reads as — "this machine does not do that at all", which is a real state. */
  none: string;
  body: string;
  value: string | null;
  options: string[];
  disabled: boolean;
  onChoose: (ref: string) => void;
}) {
  // What is stored, even when the library no longer holds it: a renamed chain must not read as "nothing is set".
  const shown =
    !value || options.includes(value) ? options : [value, ...options];
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5">
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChoose(e.target.value)}
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 text-sm"
        aria-label={label}
      >
        <option value="">{none}</option>
        {shown.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <p className="text-neutral-500 text-xs">{body}</p>
    </div>
  );
}

export function ChainsSection() {
  const [machine, setMachine] = useState<Machine | null | undefined>(undefined);
  const [view, setView] = useState<ColdChainsReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void probeMachine().then((mc) => {
      setMachine(mc);
      if (!mc) return;
      void engineMachine
        .coldChains(mc)
        .then(setView)
        .catch((e: Error) => setError(e.message));
    });
  }, []);

  /** Set it; the reply IS the new state, so a refused pick snaps back to what is actually stored. */
  const choose = (which: Which, ref: string) => {
    if (!machine) return;
    setBusy(true);
    setError(null);
    void engineMachine
      .setColdChain(machine, which, ref)
      .then(setView)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const chains = view?.chains ?? [];
  return (
    <Section
      title={m["settings.chains.title"]()}
      hint={m["settings.chains.hint"]()}
    >
      {machine === null ? (
        <p className="px-4 py-2.5 text-neutral-500 text-xs">
          {m["settings.chains.noMachine"]()}
        </p>
      ) : (
        <>
          <div className="px-4 pt-2.5 text-[10px] text-neutral-500 uppercase tracking-wide">
            {m["stems.title"]()}
          </div>
          <ChainPicker
            label={m["stems.selectLabel"]()}
            none={m["stems.none"]()}
            body={m["stems.body"]()}
            value={view?.stemsChain ?? null}
            options={chains.map((c) => c.ref)}
            disabled={!view || busy}
            onChoose={(ref) => choose("stems", ref)}
          />
          <div className="px-4 pt-2.5 text-[10px] text-neutral-500 uppercase tracking-wide">
            {m["instrumental.title"]()}
          </div>
          {/* Only those that WRITE an instrumental: four stems is not one, and the far side would refuse it. */}
          <ChainPicker
            label={m["instrumental.selectLabel"]()}
            none={m["instrumental.none"]()}
            body={m["instrumental.body"]()}
            value={view?.instrumentalChain ?? null}
            options={chains.filter((c) => c.instrumental).map((c) => c.ref)}
            disabled={!view || busy}
            onChoose={(ref) => choose("instrumental", ref)}
          />
          {/* An empty list is a real state — a library with no cold chain yet — and reads as a broken screen unless it says so. */}
          {view && chains.length === 0 && (
            <p className="px-4 py-2.5 text-neutral-500 text-xs">
              {parts((h) => m["settings.chains.noCold"](h), {
                dir: <span className="font-mono">chains/</span>,
              })}
            </p>
          )}
          {error && <p className="px-4 py-2.5 text-red-400 text-xs">{error}</p>}
        </>
      )}
    </Section>
  );
}
