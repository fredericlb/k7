// SongVariants.tsx — a song's alternative versions, as its sidecar declares them: a
// sibling audio file, or a chain the médiathèque holds. The chains are DRAWN, through the same
// ChainView the chain editor uses, with the song's own master standing where the template
// says `@in`. See packages/mediatek/docs/variants.md.

import { Button } from "@frediverse/ui/button";
import {
  CHAINS_FILE,
  type MediatekEntry,
  type SongVariant,
} from "@studio/mediatek/types";
import { AudioLines, Loader2, Workflow } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { currentUser, engineMachine, library } from "./api";
import { ChainView } from "./ChainView";
import { chainSteps, INSTANCES_DIR } from "./chainGraph";
import { useEnginePlugins } from "./engine/baseModules";
import {
  bounce,
  cacheRoot,
  chainPreviewDoc,
  type PreviewStep,
  playablePath,
} from "./engine/chainPreview";
import { resolvePluginBlock } from "./engine/resolvePlugin";
import type { ModuleEngine } from "./engine/useModuleEngine";
import { usePlayback } from "./playback/PlaybackProvider";

/** One chain variant, resolved: the entry it names and the text of its `chains.yaml`. */
interface ResolvedChain {
  variant: SongVariant;
  entry?: MediatekEntry;
  text?: string;
}

/**
 * Find the chain a variant names, among the chains family.
 *
 * By PATH first, then by name. A variant may say `blindtest/sans-voix` (unambiguous, and what
 * a deep library wants) or just `sans-voix` (what anyone actually types). Matching the path
 * first means a chain whose name collides with another's tail still resolves to the one asked
 * for, and the short form stays available for the common case where there is no ambiguity.
 */
function findChain(
  ref: string,
  entries: MediatekEntry[],
): MediatekEntry | undefined {
  const want = ref.replace(/^\/+|\/+$/g, "");
  return (
    entries.find((e) => e.path === want || e.path === `chains/${want}`) ??
    entries.find((e) => e.name === want)
  );
}

export function SongVariants({
  entry,
  engine,
  engineToken,
}: {
  entry: MediatekEntry;
  /** The app's engine, handed down by SongEditor. It used to be this pane's own
   *  `useModuleEngine(engineId)`; a song that keeps playing while you browse moved the socket
   *  above every screen, and two hooks would be two clients on one session. */
  engine: ModuleEngine;
  /** That engine's token, for the routes its file service gates. The bounce itself does not
   *  send one; analysing what came back does. */
  engineToken?: string | null;
}) {
  const playback = usePlayback();
  const variants = entry.variants ?? [];
  const chainRefs = variants.filter((v) => v.kind === "chain");
  const [chains, setChains] = useState<ResolvedChain[] | null>(null);

  // What the fetch below actually depends on, as one string.
  //
  // Not `chainRefs` itself and not `entry`: the listing is re-polled every few seconds, so both
  // are fresh objects on every tick and either would refetch the whole chains family forever.
  // This changes exactly when a variant's name or target does.
  const chainKey = chainRefs.map((v) => `${v.name}:${v.ref}`).join("|");

  // The chains listing and each named file, fetched together. The scan deliberately does NOT
  // confirm a chain exists — it invalidates one family at a time, so a song listing that
  // depended on the chains listing would go stale every time a chain changed (see the note on
  // SongVariant). This is where the two listings meet, and therefore where "no such chain"
  // is answerable at all.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: chainKey IS the dependency — derived from chainRefs, changing exactly when they do. Naming the array would refetch on every poll.
  useEffect(() => {
    if (!chainRefs.length) {
      setChains([]);
      return;
    }
    let alive = true;
    void (async () => {
      let entries: MediatekEntry[] = [];
      try {
        entries = (await library.list("chains")).entries;
      } catch {
        /* unreachable listing — every chain reads as missing, which is what it looks like */
      }
      const resolved = await Promise.all(
        chainRefs.map(async (variant) => {
          const found = findChain(variant.ref, entries);
          if (!found) return { variant };
          try {
            const { content } = await library.readFile(
              `${found.path}/${CHAINS_FILE}`,
            );
            return { variant, entry: found, text: content };
          } catch {
            // The entry is there and its file is not readable — a different fact from a
            // missing chain, and the row below says which.
            return { variant, entry: found };
          }
        }),
      );
      if (alive) setChains(resolved);
    })();
    return () => {
      alive = false;
    };
  }, [chainKey]);

  // What the input node is called once the template is applied: the song's own master. The
  // `io: file` input made concrete — the audio comes off disk, and this is the file.
  const master =
    typeof entry.meta?.master === "string" ? entry.meta.master : undefined;

  // --- auditioning ---------------------------------------------------------------
  //
  // The engine plays; this browser does not. The moteur opens PATHS on its own machine, so
  // what is auditioned is the copy in that machine's médiathèque cache — never the hosted
  // bytes this pane is listing. See docs/chainPreview.md.
  //
  // And unlike the master above it, that is not a preference: a variant IS a chain of plugins,
  // and only a moteur runs those. The playback destination therefore does not reach this pane
  // — see docs/playbackTarget.md, "what the choice does not cover".
  const [playing, setPlaying] = useState<string | null>(null);
  // The cache's absolute root on the chosen machine. Null means there is nothing to play
  // FROM — no file service answered, or that machine holds no cache.
  const [root, setRoot] = useState<string | null>(null);

  useEffect(() => {
    if (!engine.fileBase) return setRoot(null);
    let alive = true;
    void cacheRoot(engine.fileBase, currentUser(), engineToken).then((r) => {
      if (alive) setRoot(r);
    });
    return () => {
      alive = false;
    };
    // The token is in here too: it arrives with the engine probe, so the first run can have
    // none and would otherwise settle on the 401's `null` and never look again.
  }, [engine.fileBase, engineToken]);

  // Stopping when the SCREEN goes away is SongEditor's now, since the engine is its. This pane
  // can disappear on its own — a sidecar edited down to no variants — and the transport it may
  // be holding is the shared one, so stopping it here would silence the master too.

  // The chosen machine's plugin catalogue, for the resolution below.
  const scanned = useEnginePlugins(engine.client, engine.connected);

  /**
   * A chain's steps, each with the plugin it actually loads.
   *
   * Through `extends`, and that is the fix rather than a nicety: an INSTANCE declares its
   * overrides and nothing else — the real library's say `extends: "@mediatek/audio/…"` and a
   * `params:` block — so reading the file alone found no `plugin:`, and every step of every
   * variant went to the engine naming nothing to load. The same resolution the module editor
   * does, and for the same reason: see engine/resolvePlugin.ts.
   */
  const stepsOf = useCallback(
    (c: ResolvedChain): Promise<PreviewStep[]> =>
      Promise.all(
        chainSteps(c.text ?? "").map(async (name) => {
          try {
            const { content } = await library.readFile(
              `${c.entry?.path}/${INSTANCES_DIR}/${name}.yaml`,
            );
            return {
              name,
              plugin: await resolvePluginBlock(content, scanned, (p) =>
                library.readFile(p).then((m) => m.content),
              ),
            };
          } catch {
            // An instance the chain names and the folder does not hold. The step is kept, with
            // no plugin: `enginePlugin` falls back to the name, and a chain that is missing one
            // treatment should still let you hear the others rather than refusing to play.
            return { name, plugin: undefined };
          }
        }),
      ),
    [scanned],
  );

  const toggle = useCallback(
    async (c: ResolvedChain) => {
      if (playing === c.variant.name) {
        engine.stop();
        return setPlaying(null);
      }
      const path = root ? playablePath(root, entry) : null;
      if (!path || !c.text || !c.entry) return;
      // Each step's plugin, read from the HOSTED library. Only the audio has to be a path on
      // the engine's machine; what a module RUNS is data, and it is the same data here.
      const steps = await stepsOf(c);
      // One engine session plays one thing, so auditioning a variant TAKES the transport from
      // whatever the bar was following. Said out loud rather than left to drift: the bar would
      // otherwise go on reporting a master that stopped being what is audible.
      playback.close();
      // A clean edit first: an apply is a diff, so a plugin the engine's stored document does
      // not mention — a module audition's leftover — survives every document and treats this
      // variant's audio on its way out. See ../docs/playbackTarget.md.
      engine.reset();
      // From the top, said explicitly: the engine resumes from wherever its playhead was left,
      // and this session's is whatever the last document put through it ended on — which for a
      // longer song is past the end of this one, and rolls in silence.
      engine.play(
        chainPreviewDoc(path, `${entry.name} · ${c.variant.name}`, steps),
        0,
      );
      setPlaying(c.variant.name);
    },
    [engine, playback, entry, playing, root, stepsOf],
  );

  // --- processing ------------------------------------------------------------------
  //
  // One OFFLINE render per chain variant, written back beside the master as `<variante>.mp3`.
  // Offline and not the transport: `--render` opens no audio device, so this can run while
  // something is playing. See docs/chainPreview.md.
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});

  const process = useCallback(async () => {
    const path = root ? playablePath(root, entry) : null;
    if (!path || !engine.fileBase) return;
    setProcessing(true);
    setDone([]);
    setFailed({});
    // Sequential on purpose: each bounce spawns an engine on that machine, and firing N of
    // them at a library's worth of variants would have them fight for the same CPU and the
    // same plugin scan — slower in wall-clock than doing them one after another.
    for (const c of chains ?? []) {
      if (!c.text || !c.entry) continue;
      try {
        const steps = await stepsOf(c);
        const out = await bounce(
          engine.fileBase,
          currentUser(),
          chainPreviewDoc(path, `${entry.name} · ${c.variant.name}`, steps),
          engineToken,
        );
        // The extension follows what came BACK, not what was asked for: with no ffmpeg on that
        // machine the bounce is a wav, and a wav filed as `.mp3` is a file that lies about
        // itself — the scan would list it and nothing would play it.
        const name = `${c.variant.name}.${out.mp3 ? "mp3" : "wav"}`;
        await library.upload(entry.path, [
          new File([out.bytes], name, {
            type: out.mp3 ? "audio/mpeg" : "audio/wav",
          }),
        ]);
        // …and the treatment is finished, so this is the moment its waveform, its onsets and
        // its tempo get computed — the same pass an uploaded file gets, on a file that was
        // produced rather than sent. Best effort: the render is the thing that was asked for,
        // and a cache that failed to build is rebuilt by the first surface that wants it.
        //
        // The tempo it finds does NOT overwrite the song's: `setSongBpm` refuses an existing
        // key, and the sidecar's `bpm` describes the morceau, not one treatment of it.
        if (engineToken)
          await engineMachine
            .analyse(engine.fileBase, engineToken, `${entry.path}/${name}`)
            .catch(() => {});
        setDone((d) => [...d, name]);
      } catch (e) {
        // Per variant, and the loop continues: one chain naming a plugin this machine has not
        // scanned must not cost the other three their renders.
        setFailed((f) => ({ ...f, [c.variant.name]: (e as Error).message }));
      }
    }
    setProcessing(false);
  }, [chains, engine.fileBase, engineToken, entry, root, stepsOf]);

  // AFTER the hooks: an early return above them would change how many run between renders,
  // which React forbids — and a song with no variants is exactly when it would have fired.
  if (!variants.length) return null;

  const noEngine = engine.phase.k !== "ready";
  const playable = !noEngine && !!root && !!playablePath(root ?? "", entry);
  const why = noEngine
    ? "aucun moteur — choisissez-en un dans l'en-tête"
    : !root
      ? "cette machine n'a pas de cache de la médiathèque"
      : !playablePath(root, entry)
        ? "ce morceau n'a pas de fichier audio"
        : undefined;

  // Only the chain variants are rendered: a FILE variant is already a file, and bouncing it
  // would write a copy of something that is sitting right there.
  const renderable = (chains ?? []).filter((c) => c.text && c.entry).length;

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          Variantes
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {variants.length}
          </span>
        </h3>
        {/* Bounce every chain variant to a file beside the master. Offline: `--render` opens
            no audio device, so this runs happily while something is playing. */}
        {renderable ? (
          <Button
            size="sm"
            variant="outline"
            disabled={!playable || processing}
            title={why ?? `rend ${renderable} variante(s) à côté du master`}
            onClick={() => void process()}
          >
            {processing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Process
          </Button>
        ) : null}
      </div>

      {/* What the last run produced, and what it could not. Per variant, because one chain
          naming a plugin this machine has not scanned costs only its own render. */}
      {done.length ? (
        <p className="text-xs text-muted-foreground">
          écrit : <span className="font-mono">{done.join(", ")}</span>
        </p>
      ) : null}
      {Object.entries(failed).map(([name, msg]) => (
        <p key={name} className="text-xs text-destructive">
          <span className="font-mono">{name}</span> : {msg}
        </p>
      ))}

      <ul className="flex flex-col gap-1">
        {variants.map((v) => {
          const resolved = chains?.find((c) => c.variant.name === v.name);
          const missing =
            v.kind === "chain" && chains !== null && !resolved?.entry;
          return (
            <li
              key={v.name}
              className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent/40"
            >
              {v.kind === "file" ? (
                <AudioLines className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
              ) : (
                <Workflow className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {v.ref}
              </span>
              {/* A chain the library does not hold. Said out loud rather than drawn as an
                  empty box: the sidecar names something, and nothing answers to it. */}
              {missing ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-destructive">
                  introuvable
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>

      {chainRefs.length && chains === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : null}

      {/* One drawing per chain. Separate rather than merged: two variants are two different
          treatments of the same song, and overlaying them would suggest a signal path that
          runs through both. */}
      {(chains ?? [])
        .filter((c) => c.text)
        .map((c) => (
          <figure key={c.variant.name} className="flex flex-col gap-1">
            <figcaption className="text-xs text-muted-foreground">
              {c.variant.name}
              <span className="ml-2 font-mono">{c.entry?.name}</span>
            </figcaption>
            <div className="h-64 overflow-hidden rounded-md border">
              <ChainView
                text={c.text as string}
                source={master ?? undefined}
                sinkPlay={{
                  playing: playing === c.variant.name,
                  disabled: !playable,
                  title: why,
                  onToggle: () => void toggle(c),
                }}
              />
            </div>
          </figure>
        ))}
    </section>
  );
}
