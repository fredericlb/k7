// accountRoutes.ts — what is asked of the MACHINE and the ACCOUNT rather than of a workspace: one
// plugin's parameters and window, the live and cold chains, a model's download. Mounted by
// server.ts before resolveWorkspace. See docs/activeProject.md and docs/processChain.md.

import { validate, wrap } from "@frediverse/http/route";
import { coldChains } from "@studio/audio-passes/processChain";
import {
  loadPreferences,
  setInstrumentalChain,
  setStemsChain,
} from "@studio/song/preferences";
import type { ColdChainsReply } from "@studio/web-protocol";
import { Router } from "express";
import { z } from "zod";
import { benchDir } from "../bench.ts";
import { liveChains } from "../benchChain.ts";
import { pluginParams, showNativePluginUIOf } from "../engineLink.ts";
import {
  chainModuleParams,
  chainModules,
  deleteFrozenChain,
  listFrozenChains,
  saveFrozenChain,
} from "../frozenChains.ts";
import { modelDownload, startModelDownload } from "../modelDownloads.ts";
import { resolvePlugin } from "../pluginRef.ts";
export const accountRouter: Router = Router();

/** What ONE scanned plugin HAS — a plugin LOADED and asked, which takes seconds. See docs/activeProject.md. */
accountRouter.get(
  "/plugin-params",
  wrap(async (req, res) => {
    const found = resolvePlugin(
      String(req.query.ref ?? ""),
      String(req.query.format ?? ""),
      String(req.query.id ?? ""),
    );
    if ("error" in found) {
      res.status(found.status).json({ error: found.error });
      return;
    }
    const { format, id } = found;
    const answer = await pluginParams(format, id);
    if (answer === undefined) {
      res
        .status(503)
        .json({ error: "the engine did not answer — is it running?" });
      return;
    }
    res.json(answer);
  }),
);

/** …and what one LOOKS LIKE — an ORPHAN instance's own window, on this machine. See docs/activeProject.md. */
accountRouter.get(
  "/plugin-native-ui",
  wrap(async (req, res) => {
    const found = resolvePlugin(
      String(req.query.ref ?? ""),
      String(req.query.format ?? ""),
      String(req.query.id ?? ""),
    );
    if ("error" in found) {
      res.status(found.status).json({ error: found.error });
      return;
    }
    const opened = await showNativePluginUIOf(found.format, found.id);
    if (opened === undefined) {
      res.status(504).json({
        error:
          "the engine never said it opened one — it may be busy loading the plugin, or its offline engine may be wedged (the parameter scan hangs the same way)",
      });
      return;
    }
    if (!opened.ok) {
      res.status(502).json({
        error: `the engine could not open a window for ${found.id} — see its log`,
      });
      return;
    }
    res.json({ opened: found.id });
  }),
);

/** The machine's stem and instrumental chains: global settings, answered before any workspace — docs/libraries.md. */
const coldChainsView = (): ColdChainsReply => {
  const prefs = loadPreferences();
  return {
    // No library cloned, no chains — the ordinary state of a new machine, and an empty list.
    chains: coldChains(benchDir()),
    stemsChain: prefs.stemsChain ?? null,
    instrumentalChain: prefs.instrumentalChain ?? null,
  };
};

/** The libraries' chains and whether each can be PLAYED live on the bench — k7's chain source. */
accountRouter.get(
  "/account/live-chains",
  wrap((_req, res) => {
    res.json({ chains: liveChains(benchDir()) });
  }),
);

// The home page's Frozen chains: the account's own, built there, and the libraries' cold ones — docs/libraries.md.
accountRouter.get(
  "/account/frozen-chains",
  wrap((_req, res) => {
    res.json({ chains: listFrozenChains(benchDir()) });
  }),
);
accountRouter.get(
  "/account/chain-modules",
  wrap((_req, res) => {
    res.json({ modules: chainModules(benchDir()) });
  }),
);
accountRouter.get(
  "/account/chain-modules/params",
  wrap((req, res) => {
    const ref = String(req.query.ref ?? "");
    const engine = req.query.engine ? String(req.query.engine) : undefined;
    try {
      res.json(chainModuleParams(benchDir(), ref, engine));
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  }),
);
const frozenStep = z.object({
  id: z.string().optional(),
  module: z.string().min(1),
  engine: z.string().optional(),
  params: z.record(z.string(), z.union([z.number(), z.string()])),
  bypass: z.boolean().optional(),
});
accountRouter.put(
  "/account/frozen-chains/:name",
  validate(z.object({ steps: z.array(frozenStep) })),
  wrap((req, res) => {
    const { steps } = req.body as { steps: z.infer<typeof frozenStep>[] };
    try {
      res.json(saveFrozenChain(benchDir(), String(req.params.name), steps));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);
accountRouter.delete(
  "/account/frozen-chains/:name",
  wrap((req, res) => {
    try {
      deleteFrozenChain(String(req.params.name));
      res.json({ deleted: true });
    } catch (e) {
      res.status(404).json({ error: (e as Error).message });
    }
  }),
);

accountRouter.get(
  "/account/cold-chains",
  wrap((_req, res) => {
    res.json(coldChainsView());
  }),
);

accountRouter.put(
  "/account/cold-chains/:which",
  wrap((req, res) => {
    const which = req.params.which;
    if (which !== "stems" && which !== "instrumental")
      return res.status(404).json({ error: `no '${which}' chain setting` });
    const ref = String((req.body as { ref?: unknown })?.ref ?? "").trim();
    // Empty CLEARS it — "this machine does not do that" is a real answer, not a missing one.
    if (ref) {
      const chain = coldChainsView().chains.find((c) => c.ref === ref);
      if (!chain)
        return res
          .status(400)
          .json({ error: `'${ref}' is not a cold chain of the library` });
      // Stricter for the instrumental, as `system instrumental` is: four stems is not one.
      if (which === "instrumental" && !chain.instrumental)
        return res
          .status(400)
          .json({ error: `'${ref}' writes no instrumental` });
    }
    if (which === "stems") setStemsChain(ref);
    else setInstrumentalChain(ref);
    res.json(coldChainsView());
  }),
);

/** Download a cold chain's missing models, from its modules' `model_url`, one polled job each — docs/libraries.md. */
accountRouter.post(
  "/account/cold-chains/download",
  wrap((req, res) => {
    const ref = String((req.body as { ref?: unknown })?.ref ?? "").trim();
    const chain = coldChainsView().chains.find((c) => c.ref === ref);
    if (!chain)
      return res
        .status(404)
        .json({ error: `'${ref}' is not a cold chain of the library` });
    if (!chain.downloads.length)
      return res.status(400).json({
        error: `'${ref}' needs no model this machine can download`,
      });
    res.json({
      jobs: chain.downloads.map((d) => startModelDownload(d.file, d.url)),
    });
  }),
);

/** One model download, as it stands — account-level, so both the settings and a project poll it here. */
accountRouter.get(
  "/account/models/:id",
  wrap((req, res) => {
    const job = modelDownload(req.params.id);
    if (!job) return res.status(404).json({ error: "no such download" });
    res.json(job);
  }),
);
