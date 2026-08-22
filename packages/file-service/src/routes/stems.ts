// stems.ts (routes) — prepare ONE record for the desk's stem knobs: resolve the chain a
// `turntables` surface declares, then start the separation of the song somebody just put on a
// deck. Workspace-scoped, unlike /separate, because a chain ref only means anything against an
// open project. See docs/stemSplit.md and ../../ui-turntables/docs/stems.md.

import { existsSync, readdirSync } from "node:fs";
import { validate, wrap } from "@frediverse/http/route";
import { coldOutDir } from "@studio/commands/coldPass";
import { resolveChain } from "@studio/commands/processChain";
import { PathEscapesError, safePath } from "@studio/mediatek/layout";
import { isAudio } from "@studio/mediatek/media";
import { loadPreferences } from "@studio/song/preferences";
import type { StemsReply } from "@studio/web-protocol";
import { Router } from "express";
import { z } from "zod";
import { separateJob, startSeparate } from "../separateJobs.ts";

export const stemsRouter: Router = Router();

const body = z.object({
  /** The song's master, CACHE-relative — `songs/<artiste>/<album>/<titre>/original.mp3`, exactly
   *  what the desk already builds to ask for a waveform. Confined by `safePath`. */
  song: z.string().min(1),
});

/**
 * Separate one song, or say it is already done.
 *
 * **The caller does not name a chain**, and that is the shape rather than an omission. Which
 * module separates and which model it wants is one answer for this machine, kept in
 * `~/.studio/preferences.yaml` by `system stems` — so a screen that asked would be asking the same
 * question of the same person at every use, and three screens asking would be three places to get
 * it wrong.
 *
 * The chain is then resolved against the OPEN PROJECT, exactly as `playlist stems` resolves its
 * own: that is where a `@st0/…` ref becomes a module and a model becomes a path on this machine.
 * It is also the whole reason this route is workspace-scoped while `/separate` is not — the model,
 * the CPU and the GPU belong to the machine, but the vocabulary naming them belongs to a project.
 *
 * Nothing is invented for the browser: the same registry, the same worker, the same `stems/`
 * beside the master. What this adds over `POST /separate` is the resolution, which a browser
 * cannot do — it has no idea which `.onnx` this machine holds or where.
 */
stemsRouter.post(
  "/stems",
  validate(body),
  wrap((req, res) => {
    const { song } = req.body as z.infer<typeof body>;

    let source: string;
    try {
      source = safePath(song);
    } catch (e) {
      if (e instanceof PathEscapesError)
        return res.status(400).json({ error: e.message });
      throw e;
    }
    if (!existsSync(source))
      return res
        .status(404)
        .json({ error: `${song} is not in this machine's cache` });

    // Asked of the FOLDER, like every "is this fresh" question in this repo, and asked BEFORE the
    // chain is resolved: a prepared record needs no chain to be valid, so a set whose `stems:`
    // line has a typo still plays its prepared songs with live knobs.
    const outDir = coldOutDir(source);
    const held = existsSync(outDir) ? readdirSync(outDir).filter(isAudio) : [];
    if (held.length) return res.json({ ready: true, job: null } as StemsReply);

    // Asked of the machine, not of the caller — see the docblock. A 409 rather than a 400: the
    // request was fine, the machine has not been told how to separate yet, and the sentence names
    // the verb that tells it.
    const ref = loadPreferences().stemsChain;
    if (!ref)
      return res.status(409).json({
        error:
          "this machine separates nothing yet — set the chain once with `system stems <chaîne>` " +
          "(the cog, I/O)",
      });

    const dir = req.ws!.activeProjectPath();
    if (!dir)
      return res.status(409).json({
        error: "no project is open — a chain has nothing to resolve against",
      });

    let cold: ReturnType<typeof resolveChain>["cold"];
    try {
      cold = resolveChain(dir, req.ws!.cachedProjectDoc(dir), ref).cold;
    } catch (e) {
      // Caller-fixable, every one of them: a name that is not a chain, a step this machine has
      // not synced, a model nobody downloaded. The sentence carries the remedy and the desk
      // prints it verbatim, so the status only has to say "not our fault".
      return res.status(400).json({ error: (e as Error).message });
    }
    if (!cold.length)
      return res.status(400).json({
        error: `'${ref}' does not separate — \`system stems\` wants a chain whose step is an offline module`,
      });

    const started = startSeparate({
      userEmail: req.userEmail ?? "unknown",
      source,
      model: cold[0].model,
      outDir,
    });
    // Re-read rather than returned straight: `startSeparate` hands back the run already in flight
    // when one is (the id hashes the work), and that one may have moved on since.
    res.json({
      ready: false,
      job: separateJob(started.id) ?? started,
    } as StemsReply);
  }),
);
