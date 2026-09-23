// InputChannelBar.tsx — the socket an `io: in` module listens on, as a strip of controls.
// Its own file because TWO screens need it: the module builder, and st0's text editor, where an
// input is most often a two-line node nobody would think to open a builder on. Full rationale in
// docs/inputChannels.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { ChevronDown, Mic } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { useMemo, useState } from "react";

/** One input the engine can route from, as it GROUPS its channels. Mirrors EngineInputDevice. */
export interface InputDevice {
  name: string;
  channels: number[];
}

/** The socket an `io: in` module listens on, from sets the ENGINE declares — see docs/inputChannels.md. */
export function InputChannelBar({
  devices,
  channels,
  readOnly,
  onPick,
  onRegroup,
}: {
  devices: InputDevice[];
  channels: number[] | string | null;
  readOnly: boolean;
  onPick: (channels: number[]) => void;
  onRegroup?: (channel: number, stereo: boolean) => void;
}) {
  // Null until somebody flips it, so a stereo input opens on the stereo list without being told.
  const [want, setWant] = useState<1 | 2 | null>(null);
  const width =
    want ?? (Array.isArray(channels) && channels.length === 2 ? 2 : 1);
  const offered = useMemo(
    () => inputOptions(devices, width, !!onRegroup),
    [devices, width, onRegroup],
  );
  const current = Array.isArray(channels)
    ? (devices.find((d) => sameChannels(d.channels, channels))?.name ??
      `channel${channels.length > 1 ? "s" : ""} ${channels.join(", ")}`)
    : typeof channels === "string"
      ? channels // a preferences label — the rig's own naming, shown as written
      : "no input";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card/30 px-2 py-1">
      <Mic className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-medium">Input</span>
      <div className="flex overflow-hidden rounded border border-border">
        {([1, 2] as const).map((n) => (
          <button
            type="button"
            key={n}
            disabled={readOnly}
            onClick={() => setWant(n)}
            className={cn(
              "px-2 py-0.5 text-[11px]",
              width === n
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
              readOnly && "opacity-50",
            )}
          >
            {n === 1 ? "mono" : "stereo"}
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            disabled={readOnly || offered.length === 0}
            title="which of the interface's inputs this module listens on"
          >
            <span className="max-w-[16rem] truncate">{current}</span>
            <ChevronDown className="ml-1 h-4 w-4 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[50vh] w-72 overflow-y-auto"
        >
          <DropdownMenuLabel>
            {width === 1 ? "Mono inputs" : "Stereo pairs"}
          </DropdownMenuLabel>
          {offered.map((o) => (
            <DropdownMenuItem
              key={o.key}
              // Two halves in THIS order: make the device, then point the file at it.
              onSelect={() => {
                if (o.regroup) onRegroup?.(o.channels[0], width === 2);
                onPick(o.channels);
              }}
            >
              <span className="truncate">{o.label}</span>
              <span
                className={cn(
                  "ml-auto shrink-0 text-[10px]",
                  o.regroup ? "text-amber-500" : "text-muted-foreground",
                )}
              >
                {o.regroup
                  ? width === 2
                    ? "pair"
                    : "split"
                  : o.channels.join("+")}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {devices.length === 0 ? (
        <span className="truncate text-[10px] text-muted-foreground">
          no interface answering — the engine lists the inputs
        </span>
      ) : offered.some((o) => o.regroup) ? (
        // Said BEFORE it is done: a module left on the old arrangement goes quiet with no error anywhere.
        <span className="truncate text-[10px] text-amber-500">
          {width === 2 ? "pairing" : "splitting"} regroups the interface — a
          module on the old channels goes silent
        </span>
      ) : null}
    </div>
  );
}

/** One entry in the channel dropdown. `regroup` marks the ones the interface has to be rearranged for. */
export interface InputOption {
  key: string;
  label: string;
  channels: number[];
  regroup?: boolean;
}

/** What the dropdown offers for a width: what exists, then what a REGROUP could make — docs/inputChannels.md. */
export function inputOptions(
  devices: InputDevice[],
  width: 1 | 2,
  canRegroup: boolean,
): InputOption[] {
  const out: InputOption[] = devices
    .filter((d) => d.channels.length === width)
    .map((d) => ({
      key: `d:${d.name}`,
      label: d.name,
      channels: [...d.channels],
    }));
  if (!canRegroup) return out;

  const at = new Map<number, InputDevice>();
  for (const d of devices) for (const c of d.channels) at.set(c, d);

  if (width === 2) {
    // Two mono devices sitting on a hardware pair can become one stereo device.
    for (const [ch, d] of at)
      if (ch % 2 === 1 && d.channels.length === 1) {
        const next = at.get(ch + 1);
        if (next?.channels.length === 1)
          out.push({
            key: `p:${ch}`,
            label: `${d.name} + ${next.name}`,
            channels: [ch, ch + 1],
            regroup: true,
          });
      }
  } else {
    // …and a stereo device can be split back into the two mono ones it swallowed.
    for (const d of devices)
      if (d.channels.length === 2)
        for (const ch of d.channels)
          out.push({
            key: `s:${ch}`,
            label: `channel ${ch} — out of ${d.name}`,
            channels: [ch],
            regroup: true,
          });
  }
  return out;
}

// Same set, same order — what `findWaveInput` compares, so only an exact name highlights.
function sameChannels(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}
