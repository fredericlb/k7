// RecoveredTakes.tsx — the takes a crashed or closed tab left in IndexedDB, offered back on the next visit:
// Download to keep one, Discard to let it go (../../../recorder/docs/recorder.md).

import { Button } from "@frediverse/ui/button";
import { Card } from "@frediverse/ui/card";
import {
  type BackedUpTake,
  downloadTake,
  forgetTake,
  listBackedUpTakes,
  readBackedUpTake,
} from "@studio/recorder";
import { useEffect, useState } from "react";
import { confirmLoss } from "../confirm";
import { fmtDate } from "../format";
import { m } from "../paraglide/messages.js";

const megabytes = (n: number) => (n / 1024 / 1024).toFixed(1);

export function RecoveredTakes() {
  const [takes, setTakes] = useState<BackedUpTake[]>([]);

  // Read once, at load: a take recording in this tab is not left behind, and appears only after a mount that follows it.
  useEffect(() => {
    let alive = true;
    listBackedUpTakes().then((found) => {
      if (alive) setTakes(found);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (takes.length === 0) return null;

  const discard = async (take: BackedUpTake) => {
    if (
      !(await confirmLoss(
        m["recover.discardConfirm"](),
        m["recover.discard"](),
      ))
    )
      return;
    await forgetTake(take.id);
    setTakes((all) => all.filter((t) => t.id !== take.id));
  };

  return (
    <Card className="recovered-takes">
      <p>{m["recover.found"]({ count: takes.length })}</p>
      <ul>
        {takes.map((take) => (
          <li key={take.id} className="flex items-center gap-2">
            <span className="tabular">
              {fmtDate(take.startedAt, "dateTime")} · {megabytes(take.bytes)} MB
            </span>
            <Button
              size="sm"
              onClick={async () => downloadTake(await readBackedUpTake(take))}
            >
              {m["recover.download"]()}
            </Button>
            <Button size="sm" variant="outline" onClick={() => discard(take)}>
              {m["recover.discard"]()}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
