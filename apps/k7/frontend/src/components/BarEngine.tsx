// BarEngine.tsx — the engine selector inside a project, in the project bar's engine slot: where the
// sound comes out, the incompatibility warning, the link's figures and Change, on one row. A phone
// keeps the icon alone, which opens the list. The words are the sidebar's (SidebarEngine.tsx).
// See ../../docs/shell.md, "No header: the project bar is the one row above the footer".

import { Button } from "@frediverse/ui/button";
import { cn } from "@frediverse/ui/lib/utils";
import { m } from "../paraglide/messages.js";
import {
  EngineWarning,
  engineWords,
  type SidebarEngineProps,
} from "./SidebarEngine";

export function BarEngine({
  current,
  searching,
  compat,
  audioToBrowser = false,
  stats,
  onChange,
  compact = false,
  toolSize,
}: SidebarEngineProps & {
  /** A phone: the icon alone, the figures being in its info popover. */
  compact?: boolean;
  /** The bar's button size, so the icon matches the pages' buttons beside it. */
  toolSize: "icon" | "icon-xs";
}) {
  const { label, hint, incompatible, icon } = engineWords({
    current,
    searching,
    compat,
    audioToBrowser,
  });
  if (compact)
    return (
      <Button
        variant="ghost"
        size={toolSize}
        className="relative shrink-0"
        title={`${incompatible ?? label} — ${hint}`}
        aria-label={m["engineSwitch.change"]()}
        onClick={onChange}
      >
        {icon}
        {/* A dot rather than the triangle: the button has room for one glyph. */}
        {incompatible && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
        )}
      </Button>
    );
  return (
    <section
      aria-label={m["engineSwitch.section"]()}
      className="flex min-w-0 items-center gap-1.5 text-xs"
    >
      {icon}
      <span
        className={cn(
          "min-w-0 max-w-[12rem] truncate",
          current ? "text-foreground" : "text-muted-foreground",
        )}
        title={label}
      >
        {label}
      </span>
      {incompatible && <EngineWarning text={incompatible} />}
      {stats}
      <Button
        variant="secondary"
        size="xs"
        className="h-6 shrink-0 px-2"
        title={hint}
        onClick={onChange}
      >
        {m["engineSwitch.change"]()}
      </Button>
    </section>
  );
}
