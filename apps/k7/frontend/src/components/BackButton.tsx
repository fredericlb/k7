// BackButton.tsx — the arrow that opens a detail page's title row and returns to the list the
// menu entry shows. Icon-only so it fits beside the title; `to` names that list for a screen reader.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft } from "@frediverse/ui/icons";

interface Props {
  to: string;
  onClick: () => void;
}

export function BackButton({ to, onClick }: Props) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      title={`Back to ${to}`}
      aria-label={`Back to ${to}`}
    >
      <ArrowLeft className="size-4" />
    </Button>
  );
}
