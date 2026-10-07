// Tip.tsx — a hover hint on one element, through @frediverse/ui/tooltip; main.tsx mounts the
// TooltipProvider. The child must take a ref: Button, Badge, or a plain element.

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

/** A Tip only when there is something to say, as a `title=""` never showed anything. */
export function MaybeTip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}) {
  return label ? <Tip label={label}>{children}</Tip> : children;
}
