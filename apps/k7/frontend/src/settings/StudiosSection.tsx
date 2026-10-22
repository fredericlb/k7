// StudiosSection.tsx — the k7 servers this machine's engine is listed at, and the form that adds one: the phone's panel
// and the tray's engine page both draw it from their supervisor's snapshot. A server named here receives the engine's
// token and its tunnel, so the supervisor asks it first whether it is one (engine/k7-supervisor/docs/supervisorPolicy.md).

import { type ReactNode, useState } from "react";
import { m } from "../paraglide/messages.js";
import { Action, Row, Section } from "./Section";

export interface StudioRow {
  url: string;
  removable?: boolean;
}

export interface StudioCheck {
  state?: string;
  url?: string;
  message?: string;
}

export function StudiosSection({
  rows,
  check,
  add,
  addHint,
  remove,
  detail,
  extra,
}: {
  rows: StudioRow[];
  check?: StudioCheck;
  /** Absent, no form: `addHint` says why, and how to add one instead. */
  add?: (url: string) => void;
  addHint?: ReactNode;
  remove: (url: string) => void;
  /** A line under a row, or nothing. */
  detail?: (row: StudioRow) => string | undefined;
  /** More actions on a row, before Remove. */
  extra?: (row: StudioRow) => ReactNode;
}) {
  const [address, setAddress] = useState("");
  const connect = () => {
    const url = address.trim();
    if (url) add?.(url);
  };
  return (
    <Section title={m["android.studios"]()} hint={m["android.studiosHint"]()}>
      {rows.map((row) => (
        <Row key={row.url} label={row.url} detail={detail?.(row)}>
          {extra?.(row)}
          {row.removable && (
            <Action danger onClick={() => remove(row.url)}>
              {m["ai.remove"]()}
            </Action>
          )}
        </Row>
      ))}
      {!add && addHint && (
        <p className="px-4 py-2.5 text-faint text-xs">{addHint}</p>
      )}
      {add && (
        <form
          className="flex items-center gap-2 px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <input
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="https://studio.example"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200 text-sm"
          />
          <Action onClick={connect} disabled={!address.trim()}>
            {m["android.connect"]()}
          </Action>
        </form>
      )}
      {check?.state === "checking" && (
        <p className="px-4 py-2 text-faint text-xs">
          {m["android.checking"]({ url: check.url ?? "" })}
        </p>
      )}
      {check?.state === "refused" && (
        <p className="px-4 py-2 text-red-300 text-xs">{check.message}</p>
      )}
    </Section>
  );
}
