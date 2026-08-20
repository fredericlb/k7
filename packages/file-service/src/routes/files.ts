// files.ts — the project file API, re-rooted per-workspace. Mounted after
// resolveWorkspace, so `req.ws` is always a Workspace here. Every former store call
// is now a method on that workspace; the command layer takes it explicitly.

import { validate, wrap } from "@frediverse/http/route";
import {
  alternatives,
  commitAndPush,
  gitStatus,
  pull,
} from "@studio/commands/git";
import { NEEDS_META } from "@studio/commands/render";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import {
  applyPresetToModule,
  listModulePresets,
  saveModuleAsPreset,
} from "@studio/song/presets";
import { PROJECT_SHAPES } from "@studio/song/yaml/projectSchema";
import express, { Router } from "express";
import { z } from "zod";
import {
  applyClientProject,
  enginePreview,
  prewarmEngineForActive,
  reloadActiveProject,
  runWebCommand,
  snapshotPluginBase,
  startEngineForActive,
  strudelOrbitTracks,
  takeJustRecorded,
  unloadEngine,
  unloadEngineIfServing,
  webCommandList,
  webCompletions,
  webGitEnv,
} from "../engineLink.ts";
import { commitLibraries, ensureLibraries } from "../libraries.ts";
import { readLog } from "../logs.ts";
import { resolvePlugin } from "../pluginRef.ts";
import {
  preferences,
  setAudioDevicePref,
  setInputPairPref,
  setVim,
  toWebTracks,
} from "../workspace.ts";

export const filesRouter = Router();

// NOTE: /media lives in server.ts, outside the header gates — a <video> GET can't set custom headers, so it
// authenticates via the query. No single-tab lease: last write wins, and each tab's next poll reconciles.

filesRouter.get(
  "/workspace",
  wrap((req, res) => {
    // Idempotent while the engine is idle, so plugin instantiation overlaps the browser's remaining startup.
    prewarmEngineForActive(req.ws!);
    // The last take rides this poll rather than getting a route: the browser cannot work the clip's id
    // out for itself — the engine sends a file path and this service chooses the name — and it is asking
    // here every two seconds already. See takeJustRecorded.
    res.json({
      ...req.ws!.workspaceInfo(),
      lastTake: takeJustRecorded(req.ws!),
    });
  }),
);

// Global machine preferences (audio interface + channel labels + vim). Not per-workspace.
filesRouter.get(
  "/preferences",
  wrap((_req, res) => res.json(preferences())),
);
const vimBody = z.object({ vim: z.boolean() });
filesRouter.put(
  "/preferences/vim",
  validate(vimBody),
  wrap((req, res) => {
    res.json({ vim: setVim((req.body as z.infer<typeof vimBody>).vim) });
  }),
);
// The interface this machine plays through. Written here and not by the engine, which keeps no
// such memory of its own on purpose (docs/audioDevice.md): a picker tells the engine to switch
// NOW, and this to still be on it after the next restart. `type` matters — ASIO and the Windows
// endpoint of one interface share a name and not a latency.
const audioDeviceBody = z.object({
  name: z.string(),
  type: z.string().optional(),
});
filesRouter.put(
  "/preferences/audio-device",
  validate(audioDeviceBody),
  wrap((req, res) => {
    const { name, type } = req.body as z.infer<typeof audioDeviceBody>;
    res.json({ audioDevice: setAudioDevicePref(name, type) });
  }),
);
// How that interface's inputs are grouped — the other half of the same rig, remembered for the same
// reason and replayed on the same connect. `channel` is 1-based and names its PAIR, either half of it.
const inputPairBody = z.object({
  channel: z.number().int().positive(),
  stereo: z.boolean(),
});
filesRouter.put(
  "/preferences/input-pair",
  validate(inputPairBody),
  wrap((req, res) => {
    const { channel, stereo } = req.body as z.infer<typeof inputPairBody>;
    res.json({ inputPairs: setInputPairPref(channel, stereo) });
  }),
);

/**
 * The module libraries this project can reach, in precedence order.
 *
 * Beside `/tree` and not inside it: that one is deliberately the SONG, and these sit outside
 * the active project — see workspace.ts's `moduleLibraries`.
 */
filesRouter.get(
  "/module-libraries",
  wrap((req, res) => {
    res.json({ libraries: req.ws!.moduleLibraries() });
  }),
);

/**
 * The chains the library repository holds — what st0's chains builder lists.
 *
 * Beside `/module-libraries` for the same reason it is: both answer about things OUTSIDE the
 * open song, which `/tree` is deliberately not about. A chain's `path` comes from here rather
 * than being built by the caller, so opening one is addressed the way a module library is.
 */
filesRouter.get(
  "/library-chains",
  wrap((req, res) => {
    res.json({ chains: req.ws!.libraryChains() });
  }),
);

/**
 * The playlists the workspace holds, under `_playlists/`.
 *
 * The third of the same family as the two above, and here for the same reason: the folder sits
 * at the workspace root, outside the active project, so `/tree` cannot reach it.
 *
 * Only the LISTING is a route. Reading one and writing one are `/file` and `/write`, which
 * already serve any workspace path — a second pair spelling `_playlists` into their URLs would
 * be two ways to write one file, and the autosave the screen runs on is built on those two.
 */
filesRouter.get(
  "/playlists",
  wrap((req, res) => {
    res.json({ playlists: req.ws!.playlists() });
  }),
);

const newPlaylistBody = z.object({ name: z.string().min(1).max(200) });

/**
 * Make one, from the stub. A 400 for a name already taken or one that escapes the folder:
 * both are the caller's to fix by typing another, neither is a retry of this request.
 */
filesRouter.post(
  "/playlists",
  validate(newPlaylistBody),
  wrap((req, res) => {
    try {
      res.json(req.ws!.createPlaylist(req.body.name));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/**
 * Make an empty module: `<root>/<type>/<name>/module.yaml`.
 *
 * A module is a FOLDER holding a definition, so there is nothing useful "New folder…" could do
 * here — it would make a folder the loader does not recognise and a row that opens no builder.
 * This writes the one file that makes it a module, and the builder takes it from there.
 *
 * `root` is a library path the caller was GIVEN (`/module-libraries` answered it), never one it
 * built: the same rule the module builder's store follows, and what keeps `_libraries` and a
 * project's own `modules/` from being told apart by string surgery here.
 */
const moduleBody = z.object({
  root: z.string().min(1),
  rel: z.string().min(1),
});
filesRouter.post(
  "/module",
  validate(moduleBody),
  wrap((req, res) => {
    const { root, rel } = req.body as z.infer<typeof moduleBody>;
    try {
      res.json(req.ws!.createModule(root, rel));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/**
 * Publish the library: commit everything in `_libraries` and push it.
 *
 * What the module builder's Save calls once every file has landed. It touches the LIBRARY
 * repository only — the workspace holding it is somebody's song, and committing to that is
 * `project commit`. See packages/file-service/src/libraries.ts.
 *
 * A refusal is answered rather than thrown: "committed but not pushed" is a real outcome with
 * work safely on disk behind it, and the builder says so in its status line.
 */
const publishBody = z.object({ message: z.string().min(1).max(500) });
filesRouter.post(
  "/libraries/publish",
  validate(publishBody),
  wrap(async (req, res) => {
    const { message } = req.body as z.infer<typeof publishBody>;
    try {
      res.json(await commitLibraries(req.userEmail!, req.ws!.root, message));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/**
 * Open a project — and mount the account's LIBRARIES beside it first.
 *
 * `libraries` is the URI pl8 holds for this account; the browser has just read it (it refuses
 * to get this far without one, see `@studio/project-shell`'s docs/launch.md) and hands it over
 * rather than making this service ask pl8 for it. The one that knows WHO is asking is the
 * browser: this service holds a machine token, not a person's session.
 *
 * Mounted HERE and not only on clone, because the setting can be added after a workspace
 * already exists — which is the case for every workspace that predates it. Idempotent and
 * nearly free once the mount is populated.
 */
const openBody = z.object({
  path: z.string().min(1),
  libraries: z.string().min(1).optional(),
});
filesRouter.post(
  "/open",
  validate(openBody),
  wrap(async (req, res) => {
    const { path, libraries } = req.body as z.infer<typeof openBody>;
    if (libraries)
      try {
        await ensureLibraries(req.userEmail!, req.ws!.root, libraries);
      } catch (e) {
        // A mount that refuses is not a project that refuses: the song opens, and every
        // `@st0/…` ref in it reports itself missing, which is what the graph already draws a
        // `?` for. Saying so here — with the reason — beats opening onto a silent half-song.
        console.warn(`[libraries] ${(e as Error).message}`);
      }
    try {
      req.ws!.setActiveProject(path);
      startEngineForActive(req.ws!);
      res.json(req.ws!.workspaceInfo());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Unload the project and recycle its folder, whence it can't be started; a bad or recycled project is a 400.
const deleteProjectBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/project/delete",
  validate(deleteProjectBody),
  wrap(async (req, res) => {
    const { path } = req.body as z.infer<typeof deleteProjectBody>;
    try {
      const { recycled } = await req.ws!.deleteProject(path, (abs) =>
        unloadEngineIfServing(abs),
      );
      res.json({ recycled });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Make an empty folder inside `dir`; 400 on a bad name, a clobber, or the recycle bin.
const newFolderBody = z.object({
  dir: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/folder",
  validate(newFolderBody),
  wrap((req, res) => {
    const { dir, name } = req.body as z.infer<typeof newFolderBody>;
    try {
      res.json(req.ws!.createFolder(dir, name));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Rename a tree entry within its parent; 400 on a bad path, a clobber, or a protected entry.
const renameBody = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/rename",
  validate(renameBody),
  wrap(async (req, res) => {
    const { path, name } = req.body as z.infer<typeof renameBody>;
    try {
      res.json(await req.ws!.renameEntry(path, name));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Move an entry into another folder (the tree's drag-and-drop); 400 on a bad path, a clobber, or a move into self.
const moveBody = z.object({
  path: z.string().min(1),
  toDir: z.string().min(1),
});
filesRouter.post(
  "/move",
  validate(moveBody),
  wrap(async (req, res) => {
    const { path, toDir } = req.body as z.infer<typeof moveBody>;
    try {
      res.json(await req.ws!.moveEntry(path, toDir));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Delete by recycling — reversible, returning the recycled path; 400 on a bad path or a protected entry.
const deleteEntryBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/entry/delete",
  validate(deleteEntryBody),
  wrap(async (req, res) => {
    const { path } = req.body as z.infer<typeof deleteEntryBody>;
    try {
      res.json(await req.ws!.deleteEntry(path));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Clone a module folder in the same category with a new name.
const cloneModuleBody = z.object({
  path: z.string().min(1),
  newName: z.string().min(1),
});
filesRouter.post(
  "/module/clone",
  validate(cloneModuleBody),
  wrap((req, res) => {
    const { path, newName } = req.body as z.infer<typeof cloneModuleBody>;
    try {
      res.json(req.ws!.cloneModule(path, newName));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Add a node beside a module.yaml, which it inherits; `path` is the folder or any file in it.
const nodeBody = z.object({
  path: z.string().min(1),
  node: z.string().min(1),
});
filesRouter.post(
  "/node",
  validate(nodeBody),
  wrap((req, res) => {
    const { path, node } = req.body as z.infer<typeof nodeBody>;
    try {
      res.json(req.ws!.createNode(path, node));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Import a foreign project (.dawproject, .als) into a new project folder and return its path, which
// the caller then /opens.
const importBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/import-project",
  validate(importBody),
  wrap((req, res) => {
    const { path } = req.body as z.infer<typeof importBody>;
    try {
      res.json(req.ws!.importProject(path));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Scaffold a project at the workspace root and return its path — the same scaffold `st0 create` runs.
const createProjectBody = z.object({
  /**
   * The ARCHETYPE: `arrangement`, `mix` or `video` — each named after the surface it opens on.
   *
   * One field, because there is one question. Every project is an `.st0` folder, so "which app
   * opens this" has no answers to arbitrate; what is left is which scaffold runs. See
   * projectLifecycle.ts, and `PROJECT_SHAPES` for why an archetype is not a mode.
   *
   * A caller newer than this service gets a 400 naming the enum, which is the right failure:
   * a shape guessed at would land a folder whose contents nobody asked for.
   */
  shape: z.enum(PROJECT_SHAPES),
  name: z.string().min(1),
});
filesRouter.post(
  "/project/create",
  validate(createProjectBody),
  wrap((req, res) => {
    const { shape, name } = req.body as z.infer<typeof createProjectBody>;
    try {
      res.json(req.ws!.createProject(shape, name));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/**
 * Play a document the BROWSER built — the turntables surface, which fills the decks' clips into
 * this project's compile.
 *
 * Here rather than out of the browser's own socket so that ONE thing writes to the engine. Two
 * writers is what this route exists to end: the service pushing the compile from disk and a
 * surface pushing the compile-with-decks, with whichever wrote last winning. See
 * packages/song/docs/surfaces.md.
 *
 * Deliberately NOT validated field by field. It is a `ProjectDoc`, the same shape `/engine-doc`
 * just handed out, and the engine decodes by key with defaults and ignores what it does not know
 * — so a zod mirror here would be a second copy of the wire to keep in step, and its only power
 * would be to refuse documents the engine would have played. The route is behind the same gate
 * as every other one on this service.
 */
const engineProjectBody = z.object({ doc: z.looseObject({}) });
filesRouter.post(
  "/engine/project",
  validate(engineProjectBody),
  wrap((req, res) => {
    const { doc } = req.body as { doc: ProjectDoc };
    applyClientProject(req.ws!, doc);
    res.json({ ok: true });
  }),
);

// Quitting: stop and flush the engine and forget the active project. Another tab driving it will pick it back up.
// This workspace's session only — leaving one project must not stop someone else's on the shared engine.
filesRouter.post(
  "/engine/unload",
  wrap(async (req, res) => {
    await unloadEngine(req.ws!);
    res.json({ ok: true });
  }),
);

filesRouter.get(
  "/commands",
  wrap((_req, res) => res.json(webCommandList())),
);
filesRouter.get(
  "/complete",
  wrap((req, res) =>
    res.json(webCompletions(req.ws!, String(req.query.line ?? ""))),
  ),
);
// `at` is a workspace-relative folder the verbs should act on INSTEAD of the open project — the
// chains builder's template. Through `safePath` like every other path a browser sends, so it
// cannot address its way out of the workspace, and absent for every ordinary command.
const cmdBody = z.object({ line: z.string(), at: z.string().optional() });
/**
 * Run a verb, and hand back the new GRAPH with it when the project changed.
 *
 * A command that writes used to cost three sequential round trips: this one, then `/graph`, then
 * `/project-doc` — and the last two each rebuild from disk, `buildGraphDoc` through `loadGraph`
 * and `cachedProjectDoc` through `loadProject`. Measured on a real song (14 tracks, 58 clips,
 * 30 plugins): 401 ms and 367 ms, and this service is one process, so they queue rather than
 * overlap. Inserting a module in the chains graph left the canvas showing the old picture for
 * all of it.
 *
 * Building it HERE costs the same 401 ms but spends it inside a request the client is already
 * waiting on, so the canvas can redraw the moment this returns instead of a fetch and a parse
 * later. Two things follow for free: `graphDoc()` fills `graphCache`, so a client that ignores
 * the field finds a warm cache on its next `GET /graph` and is faster without
 * changing; and keying it on the revision keeps `transport play` exactly as cheap as it was.
 */
filesRouter.post(
  "/command",
  validate(cmdBody),
  wrap(async (req, res) => {
    const { line, at } = req.body as z.infer<typeof cmdBody>;
    const target = at ? req.ws!.mediaPath(at) : undefined;
    const before = req.ws!.revision().rev;
    const t0 = performance.now();
    // req.userEmail lets commit/pull pin git to this user's deploy key (see makeHost).
    const output = await runWebCommand(req.ws!, line, req.userEmail, target);
    const ran = performance.now();
    /**
     * The token AFTER the command, and the graph read in the same scope.
     *
     * One walk for the pair rather than two: `graphDoc()` opens its own scope when it is called
     * outside one, and here it is called microseconds after the token was taken — the same
     * instant, so the same answer. The walk before the command (above) stays its own: comparing
     * two moments is the whole point of it. See `Workspace.withRevision`.
     */
    const { rev, graph } = req.ws!.withRevision(() => {
      const rev = req.ws!.revision().rev;
      return {
        rev,
        graph: rev !== before ? req.ws!.graphDoc() : undefined,
      };
    });
    const changed = rev !== before;
    // One line per WRITING command, in the shape the engine's `[applyFull]` uses: the two halves
    // of the wait, so "the insert is slow" can be answered without a profiler.
    if (changed)
      console.log(
        `[cmd] ${line.trim().slice(0, 60)} — ran=${(ran - t0).toFixed(0)}ms graph=${(
          performance.now() - ran
        ).toFixed(0)}ms`,
      );
    // `refused` rides beside the lines: the command was understood and declined, which is a
    // different fact from "it ran" and from "it threw". Sent only when true, so a surface reading
    // the old shape sees exactly what it saw before.
    res.json({
      output,
      ...(output.refused ? { refused: true } : {}),
      ...(graph ? { graph, rev } : {}),
    });
  }),
);

// --- undo/redo journal ---------------------------------------------------------
// Peek without applying, so the client can enable Ctrl+Z/Y and label its toast.
filesRouter.get(
  "/history",
  wrap((req, res) => res.json(req.ws!.historyState())),
);
// A process undo restores a bounced audio file, so the client confirms it first: without
// `confirm`, a process step reports `needsConfirm` and is NOT applied; a text step applies.
const undoBody = z.object({ confirm: z.boolean().optional() });
for (const dir of ["undo", "redo"] as const) {
  filesRouter.post(
    `/${dir}`,
    validate(undoBody),
    wrap((req, res) => {
      const { confirm } = req.body as z.infer<typeof undoBody>;
      const next = dir === "undo" ? req.ws!.peekUndo() : req.ws!.peekRedo();
      if (!next) {
        res.json({ applied: false });
        return;
      }
      if (next.kind === "process" && !confirm) {
        res.json({ needsConfirm: true, ...next });
        return;
      }
      const done =
        dir === "undo" ? req.ws!.undoHistory() : req.ws!.redoHistory();
      res.json(done ? { applied: true, ...done } : { applied: false });
    }),
  );
}

// Where the repo stands vs upstream, polled by the share badge: a bounded best-effort fetch, then ahead/behind.
filesRouter.get(
  "/git/status",
  wrap((req, res) => {
    res.json(gitStatus(req.ws!.root, webGitEnv(req.userEmail)));
  }),
);

// The alternatives the header dropdown lists, with the branch each was started from.
// Local reads only (no fetch), so it is cheap enough to poll beside the status badge.
filesRouter.get(
  "/git/alternatives",
  wrap((req, res) => {
    res.json(alternatives(req.ws!.root, webGitEnv(req.userEmail)));
  }),
);

// Commit + push the WHOLE workspace repo, pinned to the user's deploy key; needs no active project.
const gitCommitBody = z.object({ message: z.string().min(1) });
filesRouter.post(
  "/git/commit",
  validate(gitCommitBody),
  wrap((req, res) => {
    const { message } = req.body as z.infer<typeof gitCommitBody>;
    try {
      res.json(commitAndPush(req.ws!.root, message, webGitEnv(req.userEmail)));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Fast-forward the WHOLE repo. A pull may have rewritten the active project, so reload it (a no-op when none).
filesRouter.post(
  "/git/pull",
  wrap((req, res) => {
    try {
      const r = pull(req.ws!.root, webGitEnv(req.userEmail));
      if (!r.upToDate) reloadActiveProject(req.ws!);
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Render the mixdown and stream it. A throw before any bytes becomes a clean 400; after headers, only a log.
filesRouter.get(
  "/export",
  wrap((req, res) => {
    const format = String(req.query.format ?? "wav") === "mp3" ? "mp3" : "wav";
    let out: {
      path: string;
      filename: string;
      mime: string;
      cleanup: () => void;
    };
    try {
      out = req.ws!.exportMix(format);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.setHeader("Content-Type", out.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${out.filename}"`,
    );
    res.sendFile(out.path, (err) => {
      out.cleanup();
      if (err && !res.headersSent)
        res.status(400).json({ error: (err as Error).message });
    });
  }),
);

// Publish to k7: a song k7 doesn't know answers { needsMeta }, and the Share menu prompts and POSTs again.
const k7Body = z.object({
  artist: z.string().optional(),
  title: z.string().optional(),
});
filesRouter.post(
  "/share/k7",
  validate(k7Body),
  wrap(async (req, res) => {
    try {
      const r = await req.ws!.shareK7(req.body as z.infer<typeof k7Body>);
      res.json({ ok: true, ...r });
    } catch (e) {
      const err = e as Error & { defaultTitle?: string };
      if (err.message === NEEDS_META) {
        res.json({
          ok: false,
          needsMeta: true,
          defaultTitle: err.defaultTitle ?? "",
        });
        return;
      }
      res.status(400).json({ error: err.message });
    }
  }),
);

/**
 * Freeze this project and send it to pl8, answering the secret its link is built from.
 *
 * No body: there is nothing to ask. A share is a snapshot of what is open, and every choice it
 * could offer — which format, which tracks, a title — is either already the project's or is a
 * decision this command deliberately does not make (see @studio/commands' docs/shareBundle.md).
 *
 * Slow, and honestly so: it is a full render. The caller greys its menu, exactly as the mixdown's
 * does.
 */
filesRouter.post(
  "/share/link",
  wrap(async (req, res) => {
    try {
      res.json({ ok: true, ...(await req.ws!.shareLink(req.userEmail!)) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

filesRouter.get(
  "/project",
  wrap((req, res) => res.json(req.ws!.projectInfo())),
);
filesRouter.get(
  "/strudel-tracks",
  wrap((_req, res) => res.json(toWebTracks(strudelOrbitTracks()))),
);
filesRouter.get(
  "/project-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.projectDoc());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/**
 * The same folder read as PICTURE — the `WebVideoProject` the viewport surface draws.
 *
 * A route of its own rather than a shape `/project-doc` might also return: the two are
 * different documents from different compilers (a song has a tempo, its picture has a
 * viewport), and one route answering either would make "which did I get" a runtime question at
 * every call site. BOTH answer for the same folder now — a song carries its own picture — and
 * a project with no `video_tracks/` gets an empty document here rather than an error, so "no
 * picture" and "broken picture" stay two different answers. See workspace.videoProjectDoc.
 */
filesRouter.get(
  "/video-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.videoProjectDoc());
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

filesRouter.get(
  "/video-errors",
  wrap((req, res) => res.json(req.ws!.videoProjectErrors())),
);

/**
 * The compiled `ProjectDoc` — what the ENGINE is given, not the shape a timeline draws.
 *
 * `/project-doc` above returns the web view: tracks and clips arranged for a screen. This one
 * is the document itself, plugins and baked DSP graphs included, and it exists because the desk
 * plays a project it did not compile. Its decks' songs are a live choice rather than an
 * arrangement, so it fills the clips in and sends the result to the engine over its own
 * socket — which needs the real document, not a picture of one.
 *
 * Read-only, and no transport of its own: WHO plays and WHEN stays with the app holding the
 * engine session. This is the compile, nothing else.
 */
filesRouter.get(
  "/engine-doc",
  wrap((req, res) => {
    try {
      res.json(req.ws!.engineDoc());
    } catch (e) {
      // A project that will not compile — the message is the compiler's own, and the caller
      // shows it rather than an empty desk.
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);
filesRouter.get(
  "/graph",
  wrap((req, res) => {
    try {
      // `?at=<rel>` asks for a folder other than the open project — a library chain, drawn by the
      // chains builder. Through safePath like every path a browser sends.
      const at = String(req.query.at ?? "");
      res.json(req.ws!.graphDoc(at ? req.ws!.mediaPath(at) : undefined));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);
// The project's `surfaces/` folder, parsed. A DERIVED view like /graph beside it, rather than
// the editor walking the tree and reading each file itself: the parse and its diagnostics are
// @studio/song's, and a second reader in the browser would be a second answer to "is this
// surface valid". Always 200 — a project with no surfaces has none, which is not an error.
filesRouter.get(
  "/surfaces",
  wrap((req, res) => res.json(req.ws!.surfaces())),
);
filesRouter.get(
  "/project-errors",
  wrap((req, res) => res.json(req.ws!.projectErrors())),
);
// The change token: poll THIS, and fetch the expensive derivations only when it differs from the last one seen.
filesRouter.get(
  "/revision",
  wrap((req, res) => res.json(req.ws!.revision())),
);
filesRouter.get(
  "/tree",
  wrap((req, res) => res.json(req.ws!.tree())),
);
filesRouter.get(
  "/hints",
  wrap((req, res) => res.json(req.ws!.hints())),
);
// Just the base-module refs, for the graph picker — a small slice of /hints, off the click's critical path.
filesRouter.get(
  "/base-modules",
  wrap((req, res) => res.json(req.ws!.baseModules())),
);
// The declared inputs and outputs (modules under an io/ folder, the shared ones included).
// Read once when the I/O panel opens; the LEVELS come from the engine socket, not here.
filesRouter.get(
  "/io-ports",
  wrap((req, res) => res.json(req.ws!.ioPorts())),
);
// The shared `_modules` catalogue — the module builder's list. Read when it opens; the
// builder then edits each module's own file through the ordinary read/write routes.
filesRouter.get(
  "/module-catalogue",
  wrap((req, res) => res.json(req.ws!.moduleCatalogue())),
);

// --- user presets ----------------------------------------------------------
// Project-local presets live in the SONG, which the engine never sees, so they are handled brain-side.

// `?ref=` is the module's own ref; an empty list (never an error) when nothing can hold presets.
filesRouter.get(
  "/presets",
  wrap((req, res) => {
    const ref = String(req.query.ref ?? "");
    if (!ref) {
      res.status(400).json({ error: "ref required" });
      return;
    }
    const dir = req.ws!.activeProjectPath();
    if (!dir) {
      res.json({ presets: [] });
      return;
    }
    try {
      res.json({ presets: listModulePresets(dir, ref) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Save a module's current persisted state as a new preset in its own preset library.
const savePresetBody = z.object({
  module: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/presets/save",
  validate(savePresetBody),
  wrap((req, res) => {
    const dir = req.ws!.activeProjectPath();
    if (!dir) {
      res.status(400).json({ error: "no active project" });
      return;
    }
    const { module, name } = req.body as z.infer<typeof savePresetBody>;
    try {
      res.json({ path: saveModuleAsPreset(dir, module, name) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

/**
 * The named bases a module may be set to — its own `base/` and every ancestor's, nearest first.
 *
 * Beside the snapshot below because it is the same folder read the other way, and answered from
 * the LOADED module rather than by listing a directory here: the ancestry is what makes the list
 * useful (the bases live on the shared module, the song points at it through a thin local one),
 * and the loader is the only thing that knows where each ancestor's folder is.
 */
filesRouter.get(
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

/**
 * Snapshot the plugin's CURRENT state into the module's `base/` folder, under a name.
 *
 * The counterpart to `/presets/save` above, for the plugins that one cannot serve. A preset is a
 * list of named numbers (`presets.yaml`), which is everything a module's `params:` can hold — and
 * for a big commercial instrument it is not the sound. An Arturia patch lives in opaque chunk
 * state: loaded from a `.vstpreset`, Wurli V2 reports the same 50 parameter values as an untouched
 * one, Mini V3 the same 77. Written as numbers, that patch is the factory default with a name on
 * it. A base is the blob, so the sound actually travels with the module.
 *
 * From the ORPHAN instance — the one the module builder's "Native UI" button opens, which belongs
 * to no project. That is what makes this usable at all: a module is authored against a plugin the
 * open project need not load, and often there is no project. It also means the state being kept is
 * exactly what somebody dialled in by hand in the plugin's own window, and nothing else.
 *
 * Three answers, because three things can go wrong and only one of them is the user's to fix:
 * 404 the ref names no scanned plugin, 503 no engine answered, 409 the engine answered that there
 * was nothing to keep — no window was ever opened for this plugin, so a snapshot would be the
 * factory defaults wearing a name somebody chose for a sound they thought they had made.
 */
const snapshotBaseBody = z.object({
  /** The module file being edited. The FOLDER comes from it here — the builder never builds a path. */
  path: z.string().min(1),
  name: z.string().min(1),
  /** `@engine/<slug>`: which plugin's orphan to read. The module's own `extends:`, as the scan and
   *  the window both take. */
  ref: z.string().min(1),
});
filesRouter.post(
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

// Apply one of a module's own presets, then reload. BY NAME: the shelf is a file in the module's folder now
// (see presets.ts), so there is no path in the body and nothing for a crafted one to escape.
const applyPresetBody = z.object({
  module: z.string().min(1),
  name: z.string().min(1),
});
filesRouter.post(
  "/presets/apply",
  validate(applyPresetBody),
  wrap((req, res) => {
    const dir = req.ws!.activeProjectPath();
    if (!dir) {
      res.status(400).json({ error: "no active project" });
      return;
    }
    const { module, name } = req.body as z.infer<typeof applyPresetBody>;
    try {
      applyPresetToModule(dir, module, name);
      reloadActiveProject(req.ws!);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

filesRouter.post(
  "/waveforms/prewarm",
  wrap((req, res) => {
    void req.ws!.prewarmWaveforms();
    res.json(req.ws!.waveformStatus());
  }),
);
filesRouter.get(
  "/waveforms/status",
  wrap((req, res) => res.json(req.ws!.waveformStatus())),
);
// Give the machine back. The batch runs a SECOND engine process to decode audio, and a surface
// that is playing wants those cores — st0 calls this when the transport starts and prewarms again
// when it stops. Sidecars already written stay written, so resuming costs only what was in flight.
filesRouter.post(
  "/waveforms/cancel",
  wrap((req, res) => {
    req.ws!.cancelPrewarm();
    res.json(req.ws!.waveformStatus());
  }),
);
filesRouter.post(
  "/waveforms/clear",
  wrap((req, res) => {
    const removed = req.ws!.clearWaveformCache();
    res.json({ ok: true, removed });
  }),
);
// The merged log for the Logs panel: `?tail=N` seeds, `?offset=X` continues. Machine-global, not per workspace.
filesRouter.get(
  "/logs",
  wrap((req, res) => {
    const rawOffset = Number(req.query.offset);
    const offset =
      req.query.offset != null && Number.isFinite(rawOffset)
        ? rawOffset
        : undefined;
    const tail = Math.max(1, Math.min(2000, Number(req.query.tail) || 300));
    res.json(readLog({ offset, tail }));
  }),
);
filesRouter.get(
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
    // `sensitivity` re-detects the source's transients at that threshold and REMEMBERS it, because it is written
    // into the sidecar. Absent, the source keeps whichever it was last built with. Bounded: 0 makes every bucket
    // an onset, and a large value makes none, so neither end is a useful thing to ask for.
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
filesRouter.post(
  "/preview",
  validate(previewBody),
  wrap((req, res) => {
    try {
      const { file, start, length } = req.ws!.resolvePreview(
        req.body as z.infer<typeof previewBody>,
      );
      enginePreview(req.ws ?? null, file, start, length);
      res.json({ ok: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

filesRouter.get(
  "/file",
  wrap((req, res) => {
    const path = String(req.query.path ?? "");
    if (!path) {
      res.status(400).json({ error: "path required" });
      return;
    }
    try {
      res.json(req.ws!.read(path));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

const writeBody = z.object({
  path: z.string().min(1),
  content: z.string(),
});
filesRouter.put(
  "/file",
  validate(writeBody),
  wrap(async (req, res) => {
    const { path, content } = req.body as z.infer<typeof writeBody>;
    try {
      // `forked` is set when the target was a shared module: the save landed on a project-local copy, and the
      // editor has to follow it — the file it had open is unchanged and still read-only.
      // recordChange journals the change (the file itself, or the forked copy + repointed chains) for Ctrl+Z.
      const r = await req.ws!.recordChange(`édition ${path}`, () =>
        req.ws!.write(path, content),
      );
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Drag-and-drop upload: raw body, target in the query, route-level raw parser. Refuses to overwrite (409).
filesRouter.post(
  "/upload",
  express.raw({ type: () => true, limit: "512mb" }),
  wrap((req, res) => {
    const dir = String(req.query.dir ?? ".");
    const name = String(req.query.name ?? "");
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes)) {
      res.status(400).json({ error: "empty upload" });
      return;
    }
    try {
      res.json(req.ws!.uploadFile(dir, name, bytes));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code === "EEXIST" ? 409 : 400;
      res.status(code).json({ error: (e as Error).message });
    }
  }),
);

// The `ui.yaml` beside a module file, which its grid edits — existing or scaffolded, saved through PUT /file
// like any other. `path` may name either of the pair, so a click on the panel opens the same builder.
filesRouter.get(
  "/module-ui",
  wrap((req, res) => {
    try {
      res.json(req.ws!.moduleUi(String(req.query.path ?? "")));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// Give an engine module a folder in the project, so it can carry a panel and presets. POST because it writes:
// a module file appears and the chains are repointed (see moduleFork.ts).
const materialiseBody = z.object({ ref: z.string().min(1) });
filesRouter.post(
  "/module-materialise",
  validate(materialiseBody),
  wrap((req, res) => {
    const { ref } = req.body as z.infer<typeof materialiseBody>;
    try {
      res.json(req.ws!.materialiseModule(ref));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

// The `presets.yaml` beside a module file — the module's third file, answered like its panel.
filesRouter.get(
  "/module-presets",
  wrap((req, res) => {
    try {
      res.json(req.ws!.modulePresets(String(req.query.path ?? "")));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  }),
);

const fmtBody = z.object({ path: z.string().min(1) });
filesRouter.post(
  "/fmt",
  validate(fmtBody),
  wrap((req, res) => {
    res.json(req.ws!.fmt((req.body as z.infer<typeof fmtBody>).path));
  }),
);
