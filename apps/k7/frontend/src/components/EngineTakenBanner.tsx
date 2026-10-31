// EngineTakenBanner.tsx — the strip over the open project once somebody else took its engine: who
// took it, "take it back" (which IS opening the project again), and the full engine list. It floats
// rather than pushing the editor down, so the gate's tree, and the project under it, never remount.
// See ../../docs/shell.md, "When somebody else takes the engine".

import { Button } from "@frediverse/ui/button";
import { UserRoundX } from "@frediverse/ui/icons";
import { m } from "../paraglide/messages.js";
import { type Taken, takenBanner } from "./engineTaken";

export function EngineTakenBanner({
  taken,
  onTakeBack,
  onOpenList,
}: {
  taken: Taken;
  onTakeBack: () => void;
  onOpenList: () => void;
}) {
  const b = takenBanner(taken);
  const title =
    b.says === "engine"
      ? m["project.engineTakenTitle"]()
      : b.says === "refused"
        ? m["project.notYoursTitle"]()
        : m["project.takenTitle"]();
  const body =
    b.says === "engine"
      ? m["project.engineTakenBody"]({
          project: taken.tookFor ?? m["project.anotherProject"](),
        })
      : b.says === "refused"
        ? m["project.notYoursBody"]()
        : b.says === "project"
          ? m["project.takenBody"]({ heldBy: taken.heldBy })
          : m["project.takenBodyAnon"]();
  return (
    <div
      role="status"
      className="fixed inset-x-4 top-2 z-40 mx-auto flex max-w-2xl flex-wrap items-start gap-3 rounded-md border border-amber-500/50 bg-background p-3 text-sm text-foreground shadow-lg"
    >
      <UserRoundX className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1 basis-60">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground">{body}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {b.takeBack && (
          <Button size="sm" onClick={onTakeBack}>
            {b.takeBack === "engine"
              ? m["project.takeEngineBack"]()
              : m["project.takeProjectBack"]()}
          </Button>
        )}
        {/* The same entry as the speaker's menu in the sidebar, under the same name. */}
        <Button size="sm" variant="outline" onClick={onOpenList}>
          {m["engineSwitch.allEngines"]()}
        </Button>
      </div>
    </div>
  );
}
