// BackButton.tsx — the arrow that opens a detail page's title row and returns to the list the
// menu entry shows. Icon-only so it fits beside the title; `to` names that list, already translated.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";

interface Props {
  to: string;
  onClick: () => void;
}

export function BackButton({ to, onClick }: Props) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="ds-button"
      onClick={onClick}
      title={m["common.backTo"]({ to })}
      aria-label={m["common.backTo"]({ to })}
    >
      <ArrowLeft className="size-4" />
    </Button>
  );
}
