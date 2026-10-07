// controls.tsx — the small controls the editor's columns repeat: a hover hint, a list row, a
// row action. A Tip's child must take a ref (Button does); main.tsx mounts the TooltipProvider.

import { Button } from "@frediverse/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@frediverse/ui/tooltip";
import type { ReactElement, ReactNode } from "react";

export function Tip({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      aria-current={active || undefined}
      className="h-auto w-full justify-start gap-2 rounded-none px-3 py-1 font-normal"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** A row action: small, quiet, and only reachable once the row is hovered or focused. */
export function RowAction({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tip label={title}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        className="text-muted-foreground [&_svg]:size-3"
      >
        {children}
      </Button>
    </Tip>
  );
}
