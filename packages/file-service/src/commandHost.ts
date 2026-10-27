// commandHost.ts — the parts of a command's host that do not depend on the run: the engine's
// catalogue queries, and the service's own work (background jobs, renders, separation, the hub's
// library listings). engineLink's makeHost spreads them in beside the run's own. See docs/activeProject.md.

import { resolve } from "node:path";
import type { CommandHost } from "@studio/commands/commands";
import type {
  AudioDeviceInfo,
  EngineClient,
  PluginInfo,
} from "@studio/engine-client/engineClient";
import {
  separateJob,
  startSeparate,
} from "@studio/stem-separation/separateJobs";
import { runInBackground } from "./backgroundJobs.ts";
import { benchDir } from "./bench.ts";
import { askBoundMachine } from "./boundMachine.ts";
import { isReady } from "./engineSessions.ts";
import { saveBenchChain } from "./frozenChains.ts";
import { askHubRemote, askHubSync } from "./libraries.ts";
import { renderPicture } from "./pictureRender.ts";
import { currentProcess } from "./processes.ts";
import type { Workspace } from "./workspace.ts";

/** How often a waiting `clip process` asks the separation registry — slow on purpose. */
const COLD_POLL_MS = 1000;

/** What a host asks the session's engine about its catalogue; `engine` flushes a held reload first. */
export function engineQueries(
  ws: Workspace,
  engine: () => EngineClient | undefined,
): Pick<CommandHost, "getPlugins" | "setInputStereo" | "getAudioDevices"> {
  return {
    getPlugins: (filter) =>
      new Promise<PluginInfo[]>((res) => {
        const c = engine();
        if (!c || !isReady(ws)) {
          res([]);
          return;
        }
        const t = setTimeout(() => res([]), 4000);
        c.once("plugins", (plugins: PluginInfo[]) => {
          clearTimeout(t);
          res(plugins);
        });
        c.listPlugins(filter);
      }),
    // `system channel type`: the engine makes the pair NOW, and answers WHETHER one heard it.
    setInputStereo: (channel, stereo) => {
      const c = engine();
      if (!c || !isReady(ws)) return false;
      c.setInputStereo(channel, stereo);
      return true;
    },
    getAudioDevices: () =>
      new Promise<AudioDeviceInfo[]>((res) => {
        const c = engine();
        if (!c || !isReady(ws)) {
          res([]);
          return;
        }
        const t = setTimeout(() => res([]), 4000);
        c.once("audioDevices", (devices: AudioDeviceInfo[]) => {
          clearTimeout(t);
          res(devices);
        });
        c.listAudioDevices();
      }),
  };
}

/** The service's own work a verb reaches through its host, the same whatever the run. */
export function serviceMembers(
  ws: Workspace,
  userEmail: string | undefined,
): Pick<
  CommandHost,
  | "background"
  | "saveBenchChain"
  | "renderPicture"
  | "clipEnvelope"
  | "onnxProviders"
  | "runColdStep"
  | "repoDir"
  | "remoteLibraryVersions"
  | "fetchLibraryVersion"
> {
  return {
    // `chain save` writes the BENCH's run, and only from the bench: a project's own graph is not a chain to keep.
    saveBenchChain: (dir, name) => {
      if (resolve(dir) !== resolve(benchDir()))
        throw new Error(
          "only the bench saves a chain — open one on the bench from the Frozen chains page",
        );
      const saved = saveBenchChain(name);
      return {
        ref: saved.ref,
        steps: saved.steps.length,
        outside: saved.outside,
      };
    },
    // Work a verb starts and does not wait for, one run per tag — a transcode (docs/background.md).
    background: (tag: string, work: () => Promise<string>) =>
      runInBackground(tag, work),
    // The picture rendered in headless Chromium, the progress on its listed process and in the log every few seconds of song.
    renderPicture: (opts) => {
      const shown = currentProcess();
      return renderPicture(ws, opts, (frame, total) => {
        shown?.progress(
          total ? frame / total : null,
          `frame ${frame} / ${total}`,
        );
        if (frame % 300 === 0)
          console.log(`   … picture render ${frame}/${total}`);
      });
    },
    // A clip's source envelope for `event trim` — the WHOLE file, from THIS workspace's waveform machinery.
    clipEnvelope: async (clip: string) => {
      try {
        const wf = await ws.waveform(clip, 2000, true);
        return wf?.rms?.length ? { peak: wf.rms, seconds: wf.seconds } : null;
      } catch {
        return null; // no envelope yet, or a clip nothing can decode — the command says so
      }
    },
    // What the bound machine separates on: its setting, read and written THERE — stem-separation/docs/stemSplit.md.
    onnxProviders: async (set) => {
      const reply = await askBoundMachine(
        set
          ? { type: "onnx-providers", set: [...set] }
          : { type: "onnx-providers" },
        "onnx-providers",
      );
      return reply ? ((reply.providers as string[] | undefined) ?? []) : null;
    },
    // `clip process` over a chain that SEPARATES, through the job registry — see docs/activeProject.md.
    runColdStep: async ({ step, source, outDir }) => {
      const started = startSeparate({
        userEmail: userEmail ?? "unknown",
        source,
        model: step.model,
        outputs: step.outputs,
        outDir,
      });
      const shown = currentProcess();
      for (;;) {
        const job = separateJob(started.id);
        // The separation's own account, on the command's listed process.
        if (job)
          shown?.progress(
            job.percent === null ? null : job.percent / 100,
            job.phase,
          );
        // Forgotten between two polls: said as itself, since the files may well be on disk.
        if (!job)
          throw new Error(
            `the separation of ${source} was forgotten by this machine — look in ${outDir}`,
          );
        if (job.failed)
          throw new Error(job.error || `separation of ${source} failed`);
        if (job.done) return job.files;
        await new Promise((r) => setTimeout(r, COLD_POLL_MS));
      }
    },
    // The workspace root, so the workspace-wide verbs work with no project open.
    repoDir: ws.root,
    // What the origin publishes, and a version this machine lacks brought down, both by the hub (../../file-hub/libraryFetch.ts).
    remoteLibraryVersions: (name) => askHubRemote(name),
    fetchLibraryVersion: async (name, version) => {
      const notes = await askHubSync({ name, version }).catch((e: Error) => [
        { name, state: "failed" as const, note: e.message },
      ]);
      const failed = notes.find((n) => n.state === "failed");
      return failed ? failed.note : null;
    },
  };
}
