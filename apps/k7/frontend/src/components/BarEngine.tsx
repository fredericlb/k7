// BarEngine.tsx — the engine selector in a bar's engine slot, the project's and the home pages': an
// icon button whose dot is the engine's state, opening the engines with their rating, then where
// this browser hears them. The list and the pick are the host's (`EngineChoice`); the words are
// engineWords.tsx's. See ../../docs/shell.md, "There is ONE engine selector".

import { Badge } from "@frediverse/ui/badge";
import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  Check,
  Circle,
  CircleDot,
  List,
  Loader2,
  RefreshCw,
} from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { formatPerformance } from "@studio/web-protocol/performance";
import { formatLatency } from "@studio/web-protocol/quality";
import type { EngineChoice } from "../engineChoice";
import { setListenHere, useListenHere } from "../listenHere";
import { m } from "../paraglide/messages.js";
import type { RankedEngine } from "../types";
import { QUALITY_VARIANT, selectableRow } from "./EngineSelect";
import {
  type EngineSelectorProps,
  EngineWarning,
  engineWords,
} from "./engineWords";

/** The dot on the button: the link is up, down, there is no engine, or one is still looked for. */
export type EngineStatus = "up" | "down" | "none" | "searching";

const DOT: Record<EngineStatus, string> = {
  up: "bg-emerald-500",
  down: "bg-red-500",
  none: "bg-amber-500",
  searching: "animate-pulse bg-muted-foreground",
};

export function BarEngine({
  current,
  searching,
  compat,
  audioToBrowser = false,
  stats,
  status,
  choice,
  toolSize,
}: EngineSelectorProps & {
  status: EngineStatus;
  choice: EngineChoice;
  /** The bar's button size, so the icon matches the pages' buttons beside it. */
  toolSize: "icon" | "icon-xs";
}) {
  const listenHere = useListenHere();
  // An engine with no speakers is heard here whatever the radio says.
  const here = listenHere || audioToBrowser;
  const { label, hint, incompatible, icon } = engineWords({
    current,
    searching,
    compat,
    audioToBrowser: here,
  });
  const statusText =
    status === "up"
      ? m["engineSwitch.linkUp"]()
      : status === "down"
        ? m["engineSwitch.linkDown"]()
        : label;
  return (
    <DropdownMenu
      // Measured when opened: the list behind it may be minutes old.
      onOpenChange={(open) => {
        if (open) choice.refresh();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={toolSize}
          className="relative shrink-0"
          title={`${label} — ${statusText}${incompatible ? ` — ${incompatible}` : ""}`}
          aria-label={m["engineSwitch.section"]()}
        >
          {icon}
          {/* The engine's state at a glance; the tooltip and the menu say it in words. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-0.5 bottom-0.5 h-2 w-2 rounded-full ring-2 ring-card",
              incompatible && status === "up" ? "bg-amber-500" : DOT[status],
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <div className="flex flex-col gap-1 px-2 py-1.5 text-xs" title={hint}>
          <div className="flex min-w-0 items-center gap-1.5">
            {icon}
            <span className="min-w-0 flex-1 truncate font-medium text-sm">
              {label}
            </span>
            {incompatible && <EngineWarning text={incompatible} />}
          </div>
          {stats && <div className="flex items-center gap-1">{stats}</div>}
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center justify-between">
          {m["engineSwitch.engines"]()}
          <button
            type="button"
            onClick={choice.refresh}
            disabled={choice.loading}
            title={m["common.refresh"]()}
            aria-label={m["common.refresh"]()}
            className="rounded p-0.5 hover:bg-accent hover:text-foreground"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", choice.loading && "animate-spin")}
            />
          </button>
        </DropdownMenuLabel>
        {choice.ranked.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-1.5 text-muted-foreground text-xs">
            {choice.loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {choice.loading ? m["engines.searching"]() : m["engines.none"]()}
          </div>
        ) : (
          <div className="max-h-[45vh] overflow-y-auto">
            {choice.ranked.map((r) => (
              <EngineRow
                key={r.engine.id}
                r={r}
                current={r.engine.id === current?.engine.id}
                onPick={() => choice.pick(r)}
              />
            ))}
          </div>
        )}
        <DropdownMenuItem onSelect={choice.openList}>
          <List className="h-4 w-4 text-muted-foreground" />
          {m["engineSwitch.allEngines"]()}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{m["engineSwitch.playsOn"]()}</DropdownMenuLabel>
        <ListenRadio
          checked={here}
          label={m["engineSwitch.thisMachine"]()}
          hint={m["engineSwitch.thisMachineHint"]()}
          onPick={() => setListenHere(true)}
        />
        <ListenRadio
          checked={!here}
          label={m["engineSwitch.theEngine"]()}
          hint={
            audioToBrowser
              ? m["engineSwitch.noSpeakers"]()
              : m["engineSwitch.theEngineHint"]()
          }
          disabled={audioToBrowser}
          onPick={() => setListenHere(false)}
        />
        {/* A disabled item shows no tooltip, so the reason is written out. */}
        {audioToBrowser && (
          <p className="px-2 pb-1.5 text-muted-foreground text-xs">
            {m["engineSwitch.noSpeakers"]()}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One engine: its name, its rating, and why it cannot be picked when it cannot. */
function EngineRow({
  r,
  current,
  onPick,
}: {
  r: RankedEngine;
  current: boolean;
  onPick: () => void;
}) {
  const why = r.needsPairing
    ? m["engineSwitch.pairing"]()
    : r.engine.assigned
      ? m["engines.inUse"]()
      : r.engine.outdated
        ? m["engines.outdated"]()
        : !r.wsUrl
          ? m["engines.noRoute"]()
          : null;
  return (
    <DropdownMenuItem
      disabled={!current && !selectableRow(r)}
      onSelect={onPick}
      aria-current={current || undefined}
    >
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          current ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="min-w-0 flex-1 truncate">
        {r.engine.hostname || r.engine.id.slice(0, 8)}
      </span>
      {r.latency ? (
        <Badge
          variant={QUALITY_VARIANT[r.latency.quality]}
          title={m["engines.latencyBreakdown"]({
            network: Math.round(r.latency.networkMs),
            audio: Math.round(r.latency.audioMs),
          })}
        >
          {formatLatency(r.latency)}
        </Badge>
      ) : (
        <Badge variant="amber">{m["engines.unreachable"]()}</Badge>
      )}
      {r.engine.performance && (
        <Badge variant="default">
          {formatPerformance(r.engine.performance)}
        </Badge>
      )}
      {why && r.latency && <Badge variant="amber">{why}</Badge>}
    </DropdownMenuItem>
  );
}

/** A radio as a menu item: choosing it keeps the menu open, so the change is seen. */
function ListenRadio({
  checked,
  label,
  hint,
  disabled,
  onPick,
}: {
  checked: boolean;
  label: string;
  hint: string;
  disabled?: boolean;
  onPick: () => void;
}) {
  const Dot = checked ? CircleDot : Circle;
  return (
    <DropdownMenuItem
      role="menuitemradio"
      aria-checked={checked}
      disabled={disabled}
      title={hint}
      onSelect={(e) => {
        e.preventDefault();
        onPick();
      }}
    >
      <Dot
        className={cn(
          "h-4 w-4 shrink-0",
          checked ? "text-primary-text" : "text-muted-foreground",
        )}
      />
      {label}
    </DropdownMenuItem>
  );
}
