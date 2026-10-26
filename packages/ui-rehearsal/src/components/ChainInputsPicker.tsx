// ChainInputsPicker.tsx — one row per live input of the bench, each with the interface's inputs to
// feed it from: a stereo pair is one entry, as the engine groups it, since a lone half of a pair
// matches nothing and stays silent. See ../../docs/chainSource.md, "Choosing the inputs".

import { Loader2 } from "@frediverse/ui/icons";
import { useState } from "react";
import type { ChainInputs } from "../chainSource";
import { m } from "../paraglide/messages.js";

/** What a channel set is called in the list: the interface's name, then the sockets. */
const deviceLabel = (d: { name: string; channels: number[] }): string =>
  `${d.name} (${d.channels.join("+")})`;

export function ChainInputsPicker({
  inputs,
  disabled,
  onPick,
}: {
  inputs: ChainInputs;
  disabled: boolean;
  onPick: (node: string, channels: number[]) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const { devices, nodes } = inputs;
  if (!nodes || !devices)
    return (
      <p className="muted small">
        <Loader2 className="size-4 animate-spin" /> {m["chain.inputsLoading"]()}
      </p>
    );
  if (!nodes.length) return null;
  return (
    <fieldset className="chain-inputs" title={m["chain.inputsHint"]()}>
      <legend className="muted small">{m["chain.inputs"]()}</legend>
      {devices.length === 0 && (
        <p className="muted small">{m["chain.noDevices"]()}</p>
      )}
      {nodes.map((n) => {
        const value = n.channel?.join(",") ?? "";
        // A channel the interface no longer offers is still shown, or the select would claim another.
        const known = devices.some((d) => d.channels.join(",") === value);
        return (
          <label key={n.node} className="chain-input">
            <span>{n.node}</span>
            <select
              value={value}
              disabled={disabled || devices.length === 0}
              onChange={(e) => {
                const chs = e.currentTarget.value.split(",").map(Number);
                setError(null);
                onPick(n.node, chs).catch((err) =>
                  setError(
                    m["chain.inputFailed"]({ message: (err as Error).message }),
                  ),
                );
              }}
            >
              {!value && (
                <option value="" disabled>
                  {m["chain.inputNone"]()}
                </option>
              )}
              {value && !known && <option value={value}>{value}</option>}
              {devices.map((d) => (
                <option key={d.channels.join(",")} value={d.channels.join(",")}>
                  {deviceLabel(d)}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {error && <p className="error">{error}</p>}
    </fieldset>
  );
}
