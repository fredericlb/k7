// ClipViewModes.tsx — the clip pane's view switch: step sequencer, piano roll, tracker. One
// control, drawn in all three headers, because a mode you can leave but not come back to is a
// trap — returning would mean reopening the clip.
// Which modes are OFFERED is the clip's business (no rack downstream, no sequencer); this
// only draws them. See docs/clipEditors.md.

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { cn } from "@frediverse/ui/lib/utils";
import { Check, ChevronDown, Grid3x3, LayoutGrid, Piano } from "lucide-react";
import { useState } from "react";
import { usePopin } from "../popins";

/** Which view of one clip's notes. `roll` and `tracker` are the two `SeqView`s plus the grid. */
export type ClipViewMode = "sequencer" | "roll" | "tracker";

const MODES: {
  id: ClipViewMode;
  label: string;
  hint: string;
  Icon: typeof Piano;
}[] = [
  {
    id: "sequencer",
    label: "séquenceur",
    hint: "un pas par cellule, une ligne par son du rack en aval",
    Icon: LayoutGrid,
  },
  {
    id: "roll",
    label: "piano roll",
    hint: "pour ce qu'une grille ne sait pas dire — vélocités, hors grille, notes que le rack ne nomme pas",
    Icon: Piano,
  },
  {
    id: "tracker",
    label: "tracker",
    hint: "les notes du fichier en texte — les flèches déplacent, les touches saisissent",
    Icon: Grid3x3,
  },
];

export function ClipViewModes({
  value,
  onChange,
  /** Offer the sequencer. False when nothing downstream of this clip's lane is a rack. */
  sequencer,
}: {
  value: ClipViewMode;
  onChange: (mode: ClipViewMode) => void;
  sequencer: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Registered while open so the shell's Esc stops at this menu rather than closing the pane behind it too (popins.ts).
  usePopin(open, () => setOpen(false));

  const modes = MODES.filter((m) => m.id !== "sequencer" || sequencer);
  const current = modes.find((m) => m.id === value) ?? modes[0];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        title="changer de vue sur ces notes"
        aria-label="vue"
      >
        <current.Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{current.label}</span>
        <ChevronDown className="h-3 w-3 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {modes.map((mode) => (
          <DropdownMenuItem
            key={mode.id}
            onSelect={() => onChange(mode.id)}
            className="gap-2 text-xs"
          >
            <Check
              className={cn(
                "h-3 w-3 shrink-0",
                mode.id !== current.id && "opacity-0",
              )}
            />
            <mode.Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-foreground">{mode.label}</span>
              <span className="block text-[10px] text-muted-foreground">
                {mode.hint}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
