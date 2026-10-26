// commandRoutes.ts — the command layer and the undo journal.
// Mounted by files.ts after resolveWorkspace, so `req.ws` is always a Workspace. See docs/fileRoutes.md.

import { validate, wrap } from "@frediverse/http/route";
import { Router } from "express";
import { z } from "zod";
import {
  runWebCommand,
  startEngineForActive,
  webCommandList,
  webCompletions,
} from "../engineLink.ts";
import { runAsProcess, SHOW_AFTER_MS } from "../processes.ts";

export const commandRouter: Router = Router();

commandRouter.get(
  "/commands",
  wrap((_req, res) => res.json(webCommandList())),
);
commandRouter.get(
  "/complete",
  wrap((req, res) =>
    res.json(
      webCompletions(
        req.ws!,
        String(req.query.line ?? ""),
        req.query.labels === "1",
      ),
    ),
  ),
);
// `at` is a folder the verbs act on INSTEAD of the open project, `want` names the views the caller will DRAW.
const cmdBody = z.object({
  line: z.string(),
  at: z.string().optional(),
  want: z.array(z.enum(["graph"])).optional(),
  // `join` folds the writes into the undo step on top, `skip` keeps them out of the journal (docs/history.md).
  journal: z.enum(["join", "skip"]).optional(),
});
/** Run a verb, and hand back the new graph, `rev` and `changed` with it — see docs/fileRoutes.md. */
commandRouter.post(
  "/command",
  validate(cmdBody),
  wrap(async (req, res) => {
    const { line, at, want, journal } = req.body as z.infer<typeof cmdBody>;
    // Absent is the default — build it. An empty list is a caller that means no.
    const wantsGraph = !want || want.includes("graph");
    const target = at ? req.ws!.mediaPath(at) : undefined;
    // A verb aimed at a library's chain writes it, so it runs only on that library's bench.
    if (target) req.ws!.assertLibraryWritable(target, "run a command on");
    const t0 = performance.now();
    // The tokens come out of the run and the graph is built inside it, so no walk of its own — docs/fileRoutes.md.
    // Listed once it has run a second, so a transcription or a bounce shows in the bar's process list.
    const {
      output,
      before,
      after: rev,
      files,
      graph,
      ranAt,
    } = await runAsProcess(
      line.trim(),
      () =>
        runWebCommand(req.ws!, line, req.userEmail, target, {
          graph: wantsGraph,
          journal,
        }),
      {
        showAfterMs: SHOW_AFTER_MS,
        failed: (r) =>
          r.output.refused ? (r.output.at(-1) ?? "refused") : undefined,
      },
    );
    // The project MOVED — "something", where `changed` on the reply below is "these files".
    const moved = rev !== before;
    // One line per WRITING command, in the shape the engine's `[applyFull]` uses — see docs/fileRoutes.md.
    if (moved)
      console.log(
        `[cmd] ${line.trim().slice(0, 60)} — ran=${(ranAt - t0).toFixed(0)}ms graph=${
          wantsGraph ? `${(performance.now() - ranAt).toFixed(0)}ms` : "skipped"
        }`,
      );
    // `refused` — understood and declined, which is neither "it ran" nor "it threw"; sent only when true.
    res.json({
      output,
      ...(output.refused ? { refused: true } : {}),
      ...(moved ? { rev, revBefore: before } : {}),
      ...(files ? { changed: files } : {}),
      ...(graph ? { graph } : {}),
    });
  }),
);

// --- undo/redo journal ---------------------------------------------------------

// Peek without applying, so the client can enable Ctrl+Z/Y and label its toast.
commandRouter.get(
  "/history",
  wrap((req, res) => res.json(req.ws!.history.state())),
);
// The History panel's list: the journal, oldest first — docs/history.md.
commandRouter.get(
  "/history/entries",
  wrap((req, res) => res.json(req.ws!.history.list())),
);
// Without `confirm` a process step reports `needsConfirm` and is NOT applied, since it restores a bounced file.
const undoBody = z.object({ confirm: z.boolean().optional() });
for (const dir of ["undo", "redo"] as const) {
  commandRouter.post(
    `/${dir}`,
    validate(undoBody),
    wrap(async (req, res) => {
      const { confirm } = req.body as z.infer<typeof undoBody>;
      const next =
        dir === "undo"
          ? req.ws!.history.peekUndo()
          : req.ws!.history.peekRedo();
      if (!next) {
        res.json({ applied: false });
        return;
      }
      if (next.kind === "process" && !confirm) {
        res.json({ needsConfirm: true, ...next });
        return;
      }
      // Throws, having written nothing, when the step's audio is kept by another engine — docs/history.md.
      const done =
        dir === "undo"
          ? await req.ws!.history.undo()
          : await req.ws!.history.redo();
      // The step rewrote the open project's files, and only a push tells the engine — as `PUT /file` does (docs/history.md).
      if (done) startEngineForActive(req.ws!);
      res.json(done ? { applied: true, ...done } : { applied: false });
    }),
  );
}
