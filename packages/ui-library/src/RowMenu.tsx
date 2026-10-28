// RowMenu.tsx — a table row's ⋮: the same actions the songs' tree offered on a right-click
// (treeActions.ts), as a dropdown, and the yes/no a removal asks first as a dialog. Actions that
// ask for a typed value are not offered here: no song action takes one. See ../docs/library.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@frediverse/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import type {
  TreeAction,
  TreeNode,
  TreeTarget,
} from "@frediverse/ui/file-tree";
import { EllipsisVertical } from "@frediverse/ui/icons";
import { useState } from "react";

/** The target a tree action expects, for a row that stands for a folder of the family. */
export const rowTarget = (rel: string, name: string): TreeTarget<TreeNode> => ({
  node: { name, path: rel, dir: true, children: [] },
  path: rel,
  name,
  dir: true,
  root: false,
});

export function RowMenu({
  target,
  actions,
  label,
  cancelLabel,
}: {
  target: TreeTarget<TreeNode>;
  actions: TreeAction<TreeNode>[];
  label: string;
  cancelLabel: string;
}) {
  const [asking, setAsking] = useState<TreeAction<TreeNode> | null>(null);
  const offered = actions.filter(
    (a) => !a.prompt && (a.when?.(target) ?? true),
  );
  if (!offered.length) return null;
  const name = (a: TreeAction<TreeNode>) =>
    typeof a.label === "function" ? a.label(target) : a.label;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={label}
            title={label}
            // The row opens or unfolds on a click; its menu must not.
            onClick={(e) => e.stopPropagation()}
          >
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {offered.map((a) => (
            <DropdownMenuItem
              key={a.key}
              className={a.danger ? "text-destructive" : undefined}
              onSelect={() => (a.confirm ? setAsking(a) : a.run(target, ""))}
            >
              {name(a)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!asking} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogTitle>{asking ? name(asking) : ""}</DialogTitle>
          <DialogDescription>
            {asking?.confirm?.message(target)}
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAsking(null)}>
              {cancelLabel}
            </Button>
            <Button
              variant={asking?.danger ? "destructive" : "default"}
              onClick={() => {
                asking?.run(target, "");
                setAsking(null);
              }}
            >
              {asking?.confirm?.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
