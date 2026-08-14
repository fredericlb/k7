// InputChannelBar.tsx — the socket an `io: in` module listens on, as a strip of controls.
// Its own file because TWO screens need it: the module builder, and l8's text editor, where an
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
import { cn } from "@frediverse/ui/lib/utils";
import { ChevronDown, Mic } from "lucide-react";
import { useMemo, useState } from "react";

/** One input the engine can route from, as it GROUPS its channels. Mirrors EngineInputDevice. */
export interface InputDevice {
  name: string;
  channels: number[];
}

/**
 * The socket an `io: in` module listens on — the one choice an input has that a plugin module doesn't.
 *
 * Every option comes from a set the ENGINE declares, never from a range of numbers: `channels` is what
 * `findWaveInput` matches exactly, so a channel that is half of a stereo device does not exist on its
 * own and asking for it reads as silence (see EngineInputDevice in @studio/engine-browser).
 *
 * Which is why mono/stereo cannot be a filter over what happens to be there — an interface enumerating
 * twenty mono inputs would offer no stereo at all. It REGROUPS: picking a pair the interface has not
 * made yet asks the engine to make it, and the write follows.
 */
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
  // Null until somebody flips it: the module's own channel count is the answer while it has one,
  // so opening a stereo input shows the stereo list without being told.
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
              // A regroup is one act with two halves: the interface is asked to make the device,
              // then the file is pointed at it. In that order — the write names a set that has to
              // exist for it to mean anything.
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
        // Said before it is done, not after: regrouping is what makes the other arrangement of these
        // channels stop existing, and a module still pointed at it goes quiet with no error anywhere.
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

/**
 * What the dropdown offers for a width: the devices that already carry it, then the ones the interface
 * could be regrouped into.
 *
 * The pairing rule is the INTERFACE's and is not negotiable — even/odd hardware channels only, so
 * 1 goes with 2 and 3 with 4, and there is no pairing of 2 with 3 to offer (Tracktion's
 * describeStandardDevices walks its channel list two at a time). Stated 1-based here, as everything
 * on the wire is, which makes the first of a pair the ODD one.
 *
 * Regroup options are withheld from a host that cannot regroup — the médiathèque draws this builder
 * with no engine to ask — leaving it the honest smaller menu rather than choices that would do nothing.
 */
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

// Same set, same order — what `findWaveInput` compares, so the picker highlights a device only when
// the file names exactly it.
function sameChannels(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}
