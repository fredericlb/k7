// The round + at the bottom right of a list page: what that page can create. With one thing to
// create a click creates it; with several it opens their menu above it, since a + alone names none.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { Plus } from "@frediverse/ui/icons";

export interface AddAction {
  label: string;
  onSelect: () => void;
}

interface Props {
  actions: AddAction[];
}

export function AddFab({ actions }: Props) {
  const button = (only?: AddAction) => (
    <Button
      className="add-fab ds-button"
      size="icon"
      title={only?.label}
      aria-label={only?.label ?? actions.map((a) => a.label).join(" / ")}
      onClick={only?.onSelect}
    >
      <Plus className="size-6" />
    </Button>
  );

  if (actions.length === 1) return button(actions[0]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button()}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="rehearsal-root min-w-48"
      >
        {actions.map((a) => (
          <DropdownMenuItem key={a.label} onSelect={a.onSelect}>
            <Plus className="size-4" /> {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
