// IoPanel.tsx — what this song can take in and put out: every module under an io/ folder, the
// project's own and those inherited from a workspace's `_modules/io`, each with a meter.
//
// A TAB of SettingsPanel.tsx, which supplies the column, the title and the ✕.
//
// The levels do NOT ride the state frame: metering an interface input enables its device
// engine-side (EngineHost::channelLevelsDb), so it is polled by request and only while this is
// on screen. Nothing pays for it once the panel closes.

import { ArrowDownToLine, ArrowUpFromLine } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import type { EngineClient, EngineInputDevice } from "@studio/engine-browser";
import { INPUT_VU_MAX_DB, INPUT_VU_MIN_DB } from "@studio/engine-browser/store";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { IoPort } from "../types";

const POLL_MS = 100; // ~10 Hz: a meter reads as live, and each frame enables devices engine-side

/** dB to a 0..1 bar, on the same scale as the timeline's input meters. */
const norm = (db: number): number => {
  const t = (db - INPUT_VU_MIN_DB) / (INPUT_VU_MAX_DB - INPUT_VU_MIN_DB);
  return t < 0 ? 0 : t > 1 ? 1 : t;
};

function Meter({ level, live }: { level: number; live: boolean }) {
  return (
    <div
      className="relative h-2 w-28 shrink-0 overflow-hidden rounded-sm bg-muted"
      title={live ? undefined : "no device on this channel"}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 origin-left",
          // Hot is worth seeing before it clips, so the bar changes colour rather than relying on a peak mark nobody watches.
          level > 0.94
            ? "bg-red-500"
            : level > 0.8
              ? "bg-amber-400"
              : "bg-emerald-500",
        )}
        // Width, not transform: a scaled bar blurs its own edge at these sizes.
        style={{ width: `${(live ? level : 0) * 100}%` }}
      />
    </div>
  );
}

// Sharps throughout: which spelling is right depends on a key the tuner does not know, so the consistent one never looks like a mistake.
const NOTE_NAMES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];
/** Concert pitch. Hard-coded rather than a setting — nothing else in st0 has a tuning reference yet. */
const A4_HZ = 440;
/** Within this many cents reads as in tune, which is the tolerance a tuner's centre band conventionally means. */
const IN_TUNE_CENTS = 5;

/** The nearest note to a frequency, and how far off it is in cents — exported for the test: the engine reports Hz and nothing else. */
export function noteOf(
  hz: number,
): { name: string; octave: number; cents: number } | null {
  if (!(hz > 0) || !Number.isFinite(hz)) return null;
  // Semitones from A4, real-valued; the fraction IS the detuning.
  const fromA4 = 12 * Math.log2(hz / A4_HZ);
  const nearest = Math.round(fromA4);
  const cents = Math.round((fromA4 - nearest) * 100);
  // MIDI 69 is A4, and C-1 is 0 — so the octave turns over at C, not at A.
  const midi = nearest + 69;
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    cents,
  };
}

/** The tuner: nearest note, and a needle for how far off it sits. Blank until a note is heard. */
function Tuner({ hz, clarity }: { hz: number; clarity: number }) {
  const note = noteOf(hz);
  if (!note)
    return (
      <div className="flex flex-1 items-center pl-1">
        <span className="text-[10px] text-muted-foreground/50">no note</span>
      </div>
    );
  const inTune = Math.abs(note.cents) <= IN_TUNE_CENTS;
  // ±50 cents spans the bar: past that the NEXT note is nearer, so the needle can't leave it.
  const offset = 50 + Math.max(-50, Math.min(50, note.cents));
  return (
    <div
      className="flex flex-1 items-center gap-1.5"
      // A weak reading fades rather than disappearing: a note flickering in and out is harder to tune against than a visibly uncertain one.
      style={{ opacity: 0.4 + 0.6 * Math.max(0, Math.min(1, clarity)) }}
      title={`${hz.toFixed(1)} Hz`}
    >
      <span
        className={cn(
          "w-9 shrink-0 text-right font-mono text-[11px] tabular-nums",
          inTune ? "text-emerald-500" : "text-foreground",
        )}
      >
        {note.name}
        <span className="text-[9px] text-muted-foreground">{note.octave}</span>
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-muted">
        {/* The centre mark, so "in tune" is a place on the bar and not just a colour. */}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border" />
        <div
          className={cn(
            "absolute inset-y-0 w-1 -translate-x-1/2 rounded-sm",
            inTune ? "bg-emerald-500" : "bg-amber-400",
          )}
          style={{ left: `${offset}%` }}
        />
      </div>
      <span className="w-7 shrink-0 text-[9px] tabular-nums text-muted-foreground">
        {note.cents > 0 ? `+${note.cents}` : note.cents}
      </span>
    </div>
  );
}

/** One row of the panel: a name, what it is wired to, its meter — and, for an input, its tuner on the line below. */
function PortRow({
  name,
  detail,
  live,
  level,
  tuned,
  hz,
  clarity,
}: {
  name: React.ReactNode;
  detail: string;
  /** Whether there is a channel behind it to meter: a generic or an unwired port has none. */
  live: boolean;
  level: number;
  /** An input, which gets a tuner — an output carries a mix with no single note to find. */
  tuned: boolean;
  hz: number;
  clarity: number;
}) {
  return (
    <div className="flex flex-col gap-1 px-2 py-1.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {name}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {detail}
        </span>
        <Meter level={level} live={live} />
      </div>
      {/* The tuner on its own line, as wide as the row: a needle squeezed beside the meter was too short to tune against. */}
      {tuned && (
        <div className="flex">
          <Tuner hz={live ? hz : 0} clarity={live ? clarity : 0} />
        </div>
      )}
    </div>
  );
}

/** What a declared port says about its channels, for the row's detail. */
function portDetail(port: IoPort): string {
  const live = port.channels.length > 0;
  return port.unknownLabel
    ? `'${port.label}' — no such input`
    : port.label
      ? `${port.label} (${port.channels.join("+")})`
      : live
        ? `ch ${port.channels.join("+")}`
        : port.generic
          ? "generic"
          : "no channel";
}

/** A declared port's name, with the catalogue it comes from. */
function portName(port: IoPort): React.ReactNode {
  return (
    <>
      {port.name}
      {port.namespace && (
        <span className="ml-1 text-[10px] text-muted-foreground">
          @{port.namespace}
        </span>
      )}
    </>
  );
}

const sameChannels = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((c, i) => c === b[i]);

export function IoPanel({
  /** Null when the engine is not connected: the list still shows, the meters stay dark. */
  engine,
}: {
  engine: EngineClient | null;
}) {
  const [ports, setPorts] = useState<IoPort[] | null>(null);
  const [levels, setLevels] = useState<{
    inputs: number[];
    master: number;
    pitches: number[];
    clarity: number[];
    devices?: EngineInputDevice[];
  }>({ inputs: [], master: -100, pitches: [], clarity: [] });
  // The INTERFACE's inputs, as the engine groups them — every one, not only those a song declares.
  const [devices, setDevices] = useState<EngineInputDevice[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .ioPorts()
      .then((p) => alive && setPorts(p))
      .catch(() => alive && setPorts([]));
    return () => {
      alive = false;
    };
  }, []);

  // Escape belongs to the PANEL, which closes whichever tab is showing — two listeners for one key would close it twice.

  const inputs = useMemo(
    () => (ports ?? []).filter((p) => p.dir === "in"),
    [ports],
  );
  const outputs = useMemo(
    () => (ports ?? []).filter((p) => p.dir === "out"),
    [ports],
  );

  // The channel sets, in the order the reply is indexed by, and held in a ref: rebuilding the interval per level frame would restart the timer.
  // Once the engine has said what the interface has, those are what is metered; before, the song's declared inputs.
  const sets = useMemo(
    () =>
      devices.length
        ? devices.map((d) => d.channels)
        : inputs.map((p) => p.channels),
    [devices, inputs],
  );
  const setsRef = useRef(sets);
  setsRef.current = sets;

  useEffect(() => {
    if (!engine || !ports) return;
    const off = engine.onIoLevels((l) => {
      setLevels(l);
      // Kept only when it CHANGES: a fresh array every frame would re-key the sets and the poll with them.
      if (l.devices?.length)
        setDevices((cur) =>
          cur.length === l.devices.length &&
          cur.every(
            (d, i) =>
              d.name === l.devices[i].name &&
              sameChannels(d.channels, l.devices[i].channels),
          )
            ? cur
            : l.devices,
        );
    });
    const id = setInterval(() => engine.ioLevels(setsRef.current), POLL_MS);
    engine.ioLevels(setsRef.current); // …and one straight away, so the panel isn't blank on open
    return () => {
      clearInterval(id);
      off();
    };
  }, [engine, ports]);

  const heading = (title: string, icon: React.ReactNode) => (
    <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
      {icon}
      {title}
    </div>
  );
  const none = (
    <div className="px-2 py-1.5 text-xs text-muted-foreground">
      none declared
    </div>
  );
  // The pitch arrays are indexed like the sets asked for, so an input row reads its own.
  const inputRows = devices.length
    ? devices.map((d, i) => {
        // Which of the song's inputs listen here — named, since that is what a channel is FOR in this song.
        const users = inputs
          .filter((p) => sameChannels(p.channels, d.channels))
          .map((p) => p.name);
        return (
          <PortRow
            key={`dev:${d.name}`}
            name={`in ${d.name}`}
            detail={users.length ? users.join(", ") : "unused"}
            live={d.enabled}
            level={norm(levels.inputs[i] ?? -100)}
            tuned
            hz={levels.pitches[i] ?? 0}
            clarity={levels.clarity[i] ?? 0}
          />
        );
      })
    : inputs.map((p, i) => (
        <PortRow
          key={p.ref}
          name={portName(p)}
          detail={portDetail(p)}
          live={p.channels.length > 0}
          level={norm(levels.inputs[i] ?? -100)}
          tuned
          hz={levels.pitches[i] ?? 0}
          clarity={levels.clarity[i] ?? 0}
        />
      ));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {ports === null ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            …
          </div>
        ) : (
          <>
            {heading("inputs", <ArrowDownToLine className="h-3 w-3" />)}
            {inputRows.length ? (
              <div className="divide-y divide-border/50">{inputRows}</div>
            ) : (
              none
            )}
            {/* Every out sink shares one meter: what leaves is the master mix, and Tracktion gives an output DEVICE no measurer. */}
            {heading("outputs", <ArrowUpFromLine className="h-3 w-3" />)}
            {outputs.length ? (
              <div className="divide-y divide-border/50">
                {outputs.map((p) => (
                  <PortRow
                    key={p.ref}
                    name={portName(p)}
                    detail={portDetail(p)}
                    live={p.channels.length > 0}
                    level={norm(levels.master)}
                    tuned={false}
                    hz={0}
                    clarity={0}
                  />
                ))}
              </div>
            ) : (
              none
            )}
          </>
        )}
      </div>
      {!engine && (
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
          engine not connected — levels are idle
        </div>
      )}
    </div>
  );
}
