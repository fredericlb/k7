// BenchSaveButton.tsx — the project bar's "Save to chain", on the bench and nowhere else: it runs
// `chain save`, into the chain the bench was opened on when that one is the account's, else under a
// name it asks. A new chain then reopens the bench on itself, so a reload rebuilds from what was saved.
// See ../../docs/frozenChains.md.

import { Button } from "@frediverse/ui/button";
import { Save } from "@frediverse/ui/icons";
import { askText } from "@studio/project-shell/ask";
import { launchUrl, parseLaunch } from "@studio/project-shell/launch";
import {
  BENCH_REPO,
  benchChainOf,
  benchProject,
  isBench,
} from "@studio/web-protocol/projects";
import { m } from "../paraglide/messages.js";

const MINE = "@account/";

/** The bench's chain, when this tab's address is a bench; null on the bare rig, undefined elsewhere. */
function benchChain(): string | null | undefined {
  const at = parseLaunch(
    window.location.pathname,
    "k7",
    import.meta.env.BASE_URL,
  );
  return at && isBench(at.repo)
    ? (benchChainOf(at.project) ?? null)
    : undefined;
}

export function BenchSaveButton({
  size,
  runCommand,
}: {
  size: "icon" | "icon-xs";
  runCommand: (line: string, outcome?: { ok: boolean }) => Promise<void>;
}) {
  const chain = benchChain();
  if (chain === undefined) return null;
  const own = chain?.startsWith(MINE) ? chain.slice(MINE.length) : null;
  const label = own ? m["bench.saveInto"]({ name: own }) : m["bench.saveAs"]();
  const save = async () => {
    const name =
      own ??
      (await askText({
        title: m["bench.saveAs"](),
        body: m["bench.saveBody"](),
        placeholder: m["frozen.namePlaceholder"](),
        initial: chain?.split("/").pop() ?? "",
        confirmLabel: m["frozen.save"](),
      }));
    if (!name) return;
    const outcome = { ok: false };
    await runCommand(own ? "chain save" : `chain save ${name.trim()}`, outcome);
    if (outcome.ok && !own)
      window.location.assign(
        launchUrl(
          window.location.origin,
          BENCH_REPO,
          benchProject(`${MINE}${name.trim()}`),
          "k7",
        ),
      );
  };
  return (
    <Button
      size={size}
      variant="ghost"
      className="shrink-0"
      onClick={() => void save()}
      aria-label={label}
      title={label}
    >
      <Save className="size-3.5" />
    </Button>
  );
}
