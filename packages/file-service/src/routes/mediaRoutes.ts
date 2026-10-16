// mediaRoutes.ts — presets and module bases, the waveforms, the logs and the preview.
// Mounted by files.ts after resolveWorkspace, so `req.ws` is always a Workspace. See docs/fileRoutes.md.

import { validate, wrap } from "@frediverse/http/route";
import { listNodePresets } from "@studio/song-edit/presets";
import { Router } from "express";
import { z } from "zod";
import { guard } from "../background.ts";
import { enginePreview, snapshotPluginBase } from "../engineLink.ts";
import { boundMachineLog } from "../machineLog.ts";
import { resolvePlugin } from "../pluginRef.ts";
import { serviceLogSince } from "../serviceLog.ts";

export const mediaRouter: Router = Router();

// A NODE's presets, keyed by the module it extends — applying, saving and updating are `node preset` verbs.
mediaRouter.get(
  "/presets",
  wrap((req, res) => {
    const node = String(req.query.node ?? "");
    if (!node) {
      res.status(400).json({ error: "node required" });
      return;
    }
    const dir = req.ws!.activeProjectPath();
    if (!dir) {
      res.status(400).json({ error: "no active project" });
      return;
    }
    try {
      res.json(listNodePresets(dir, node));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/** The named bases a module may be set to — its own `base/` and every ancestor's, nearest first. */
mediaRouter.get(
  "/module-base",
  wrap((req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) {
      res.status(400).json({ error: "path is required" });
      return;
    }
    try {
      res.json({ bases: req.ws!.moduleBases(path) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/** Snapshot the ORPHAN plugin's opaque state into the module's `base/` folder — see docs/fileRoutes.md. */
const snapshotBaseBody = z.object({
  /** The module file being edited. The FOLDER comes from it here — the builder never builds a path. */
  path: z.string().min(1),
  name: z.string().min(1),
  /** `@engine/<slug>`: which plugin's orphan to read — the module's own `extends:`. */
  ref: z.string().min(1),
});
mediaRouter.post(
  "/module-base/snapshot",
  validate(snapshotBaseBody),
  wrap(async (req, res) => {
    const { path, name, ref } = req.body as z.infer<typeof snapshotBaseBody>;
    const plugin = resolvePlugin(ref, "", "");
    if ("error" in plugin) {
      res.status(plugin.status).json({ error: plugin.error });
      return;
    }
    let where: { abs: string; path: string };
    try {
      where = req.ws!.baseSnapshotPath(path, name);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const wrote = await snapshotPluginBase(plugin.format, plugin.id, where.abs);
    if (wrote === undefined) {
      res
        .status(503)
        .json({ error: "the engine did not answer — is it running?" });
      return;
    }
    if (!wrote.ok) {
      res.status(409).json({
        error:
          "nothing to snapshot — open the plugin's window with « Native UI » and set it up first",
      });
      return;
    }
    res.json({ path: where.path });
  }),
);

mediaRouter.post(
  "/waveforms/prewarm",
  wrap((req, res) => {
    // Fire-and-forget, so `wrap` cannot see it: it only catches what the handler RETURNS.
    guard("waveform prewarm", req.ws!.prewarmWaveforms());
    res.json(req.ws!.waveformStatus());
  }),
);
mediaRouter.get(
  "/waveforms/status",
  wrap((req, res) => res.json(req.ws!.waveformStatus())),
);
// Give the machine back: the decode batch runs a SECOND engine process, and a playing surface wants those cores.
mediaRouter.post(
  "/waveforms/cancel",
  wrap((req, res) => {
    req.ws!.cancelPrewarm();
    res.json(req.ws!.waveformStatus());
  }),
);
// The Logs panel: the engine machine's `.studio.log` (`?tail`, `?offset`) and this service's lines (`?after`) — docs/serviceLog.md.
mediaRouter.get(
  "/logs",
  wrap(async (req, res) => {
    const num = (v: unknown): number | undefined => {
      const n = Number(v);
      return v != null && Number.isFinite(n) ? n : undefined;
    };
    const offset = num(req.query.offset);
    const tail = Math.max(1, Math.min(2000, Number(req.query.tail) || 300));
    res.json({
      ...(await boundMachineLog({ offset, tail })),
      service: serviceLogSince(num(req.query.after), tail),
    });
  }),
);
mediaRouter.get(
  "/waveform",
  wrap(async (req, res) => {
    const clip = String(req.query.clip ?? "");
    if (!clip) {
      res.status(400).json({ error: "clip required" });
      return;
    }
    const buckets = Math.max(
      16,
      Math.min(4000, Number(req.query.buckets) || 1000),
    );
    // `whole=1` asks for the source's full duration rather than the placement's span — what a clips/*.yaml shows.
    const whole = req.query.whole === "1" || req.query.whole === "true";
    // `sensitivity` re-detects the transients at that threshold and REMEMBERS it — see docs/fileRoutes.md.
    const raw = Number(req.query.sensitivity);
    const sensitivity = Number.isFinite(raw)
      ? Math.max(0.25, Math.min(8, raw))
      : undefined;
    try {
      res.json(await req.ws!.waveform(clip, buckets, whole, sensitivity));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

// Audition one sample: resolve it to a file + window and let the engine fire a voice, independent of the transport.
const previewBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("source"), source: z.string().min(1) }),
  z.object({ kind: z.literal("clip"), clip: z.string().min(1) }),
  z.object({
    kind: z.literal("slice"),
    source: z.string().min(1),
    from: z.number(),
    to: z.number(),
  }),
]);
mediaRouter.post(
  "/preview",
  validate(previewBody),
  wrap((req, res) => {
    try {
      const { file, start, length } = req.ws!.resolvePreview(
        req.body as z.infer<typeof previewBody>,
      );
      enginePreview(req.ws ?? null, file, start, length);
      // The window that was actually SENT, so the caller never resolves it twice — see docs/fileRoutes.md.
      res.json({ ok: true, start, length });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);
