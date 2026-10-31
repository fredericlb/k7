// BackButton.tsx — the way back from a detail page to the list the menu entry shows: the same
// labelled arrow the médiathèque's pages draw (packages/ui-library/src/LibraryPage.tsx). `to` names
// that list, already translated, for the tooltip and assistive technology.

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
      size="sm"
      className="ds-button shrink-0"
      onClick={onClick}
      title={m["common.backTo"]({ to })}
      aria-label={m["common.backTo"]({ to })}
    >
      <ArrowLeft className="size-4" />
      <span className="hidden sm:inline">{m["common.back"]()}</span>
    </Button>
  );
}
