// useModuleEngine.ts — the ONE socket to the engine this account chose. It carries the
// transport for anything the moteur plays for the médiathèque: a chain variant, a song, a
// playlist. It used to load MODULES too — that left with the builder, which is in l8 now,
// where a plugin can be loaded into a real project. See docs/engine.md, docs/playbackTarget.md.

import { EngineClient, type EngineWarning } from "@studio/engine-browser";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentUser, engines } from "../api";

export type EnginePhase =
  | { k: "looking" }
  | { k: "absent" }
  | { k: "ready"; id: string };

export interface ModuleEngine {
  phase: EnginePhase;
  /**
   * The socket itself, for a screen whose questions are the MACHINE's rather than a project's
   * — the device list, the session list, the installed catalogue.
   *
   * Exposed rather than wrapped verb by verb because that screen (EnginePage) asks a dozen
   * of them and drives no document; what it must not do is open a second connection, which is
   * exactly what it did before there was one socket to borrow. Null until one exists.
   */
  client: EngineClient | null;
  /** Whether that socket is OPEN. `phase: ready` only says one was made and told to connect;
   *  a screen that queries on connect needs the difference. */
  connected: boolean;
  /** Whether the engine says it is playing, and where its playhead is (seconds).
   *
   *  From the engine's own state push, never from a hopeful local flag set on click: the
   *  transport is on another machine, so "did it start" and "where is it" are answers only
   *  that machine has. m9's useEngine reads the same frame for the same reason. */
  playing: boolean;
  playhead: number;
  /**
   * The last thing the engine complained about, or null.
   *
   * It was being thrown away, and that is expensive precisely here: a document naming a file
   * the engine cannot open — absent, or in a format that build has no reader for — raises
   * `clip source not found/invalid: <path>` and then plays SILENCE. Silence is the one
   * failure a transport cannot report by itself, so the only account of it is this channel.
   *
   * Cleared when a new document is sent, so what is shown is about what is playing now.
   */
  warning: EngineWarning | null;
  /** The chosen machine's file service, as its own probe reported it — null when none answered.
   *  The médiathèque is hosted and the moteur opens PATHS, so anything that plays audio has to
   *  find it on that machine's disk. See m9's docs/plumbing.md, which walks the same route. */
  fileBase: string | null;
  /** What leaves whatever is playing, in dB. -100 is nothing. */
  outputLevel: number;
  /**
   * Send a document and start the transport — what a chain preview needs and a module preview
   * does not. It REPLACES whatever this session held, the one-module doc included: the session
   * is per service and per person (see below), and auditioning two things at once on one engine
   * is not a thing to arrange, it is a thing to forbid.
   */
  /**
   * `fromSeconds` says where to start, and leaving it out is almost always wrong.
   *
   * `EngineHost::play` repositions the playhead only when the transport is LOOPING; otherwise
   * it resumes from wherever it was. A session outlives the documents put through it — it is
   * keyed by service and person, not by what is loaded — so the playhead can sit well past
   * the end of the clip just sent, and the transport then rolls in silence with `playing`
   * perfectly true. That is a failure with no symptom other than no sound.
   */
  play: (doc: ProjectDoc, fromSeconds?: number) => void;
  /**
   * Throw this session's edit away, so the next document builds one from nothing.
   *
   * Needed because an apply is a DIFF, and a diff can only remove what the engine's stored
   * document says is there. An edit can hold a plugin that document does not mention — a
   * module audition left one behind, measured on this machine — and then no document will
   * ever remove it: the diff sees no change, so nothing rebuilds. What plays afterwards runs
   * through a module nobody asked for, which for a `crossfade` is -100 dB. Silence, from a
   * transport reporting that it is rolling.
   *
   * The session comes back on the next apply — it is created by a client driving it.
   */
  reset: () => void;
  stop: () => void;
  /** Scrub to an absolute position, in seconds. Its own verb rather than a re-send of the
   *  document: the engine keeps playing across a seek, and a document would restart it. */
  seek: (seconds: number) => void;
  retry: () => void;
}

/**
 * The engine this ACCOUNT auditions modules through.
 *
 * It used to be loopback and nothing else, on the argument that a preview must play on the
 * machine the module will be used from — so "which of my engines" had no question to
 * answer. That was true while a person had one machine. Now the médiathèque holds its own
 * registry, the choice is remembered on the account, and the policy lives in
 * `chooseEngine` where it can be tested.
 *
 * An absent engine is still a normal state: the editor edits text either way, it just
 * cannot offer a parameter list.
 *
 * `engineId` is the account's current pick, handed down by whoever draws the picker. It used
 * to be read here and only here, because the editor REPLACED the screen the picker lives on
 * and a choice therefore could not move while it was open. The editor sits beside that header
 * now, so it can — and a socket left on the previous machine would answer for a plugin loaded
 * somewhere else. Omitted, it falls back to the stored preference exactly as before.
 */
export function useModuleEngine(engineId?: string): ModuleEngine {
  const [phase, setPhase] = useState<EnginePhase>({ k: "looking" });
  const [fileBase, setFileBase] = useState<string | null>(null);
  // What leaves whatever is playing, in dB. From the engine's own frame: the signal is on
  // another machine, so its level is a thing only that machine can report.
  const [outputLevel, setOutputLevel] = useState(-100);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [warning, setWarning] = useState<EngineWarning | null>(null);
  const [client, setClient] = useState<EngineClient | null>(null);
  const [connected, setConnected] = useState(false);
  const engine = useRef<EngineClient | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  // Stops the renew loop and says goodbye. Held in a ref because the lease is taken inside an
  // async body, long after the effect returned its cleanup.
  const lease = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase({ k: "looking" });
    void (async () => {
      // The caller's pick wins over the stored one: it is the same value, but it arrives
      // already updated when someone changes it from the header beside this editor, whereas
      // the fetch inside would still be answering with what was saved a moment ago.
      const { chosen } = await engines.find(engineId);
      if (cancelled) return;
      if (!chosen) return setPhase({ k: "absent" });
      const found = chosen;
      setFileBase(found.fileBase ?? null);
      // The lease, exactly as l8' EngineGate holds it. A miss is not fatal: it marks the
      // engine in use, it does not grant the connection, which the browser makes itself.
      lease.current?.(); // a previous one, if this effect re-ran on a new choice
      // `project: null` — and that is the whole of st0's relationship to the claim. The
      // médiathèque drives an engine without ever opening a project, so it must not compete for
      // one: claiming here would take a song away from the l8 tab next door every time somebody
      // looked at the catalogue. It still holds the ENGINE, which is what marks it in use.
      lease.current = engines.hold(found, { project: null });

      // Per SERVICE and per PERSON: the médiathèque is hosted, so two people can choose the
      // same machine, and on a bare "st0" one of them starting a song would tear down the
      // other's mid-listen. It also keeps this out of the slot l8 has a song in.
      const client = new EngineClient(
        // Measured once here, re-measured before every reconnect: the relayed URL's ticket
        // outlives nothing, and a preview pane stays open far longer than a minute.
        engines.linkUrl(found),
        undefined,
        sessionFor(SESSIONS.st0, currentUser()),
      );
      engine.current = client;
      // The transport, as the engine reports it. Subscribed always and not only while
      // something plays: a session can already be running when this tab connects — the same
      // person left it playing in another one — and a pane that assumed silence would draw a
      // Play button over a song that is audible.
      client.onState((s) => {
        setPlaying(s.playing);
        setPlayhead(s.playhead);
        // What the médiathèque plays is one track at a time, so its level is the first of the
        // list. -100 is the engine's "nothing", and reads as an empty meter either way.
        setOutputLevel(s.levels?.[0] ?? -100);
      });
      // Kept rather than dropped: this is how the engine says a clip could not be opened, and
      // what it says next is silence. See `warning` above.
      client.onWarning(setWarning);
      client.onConnected(setConnected);
      setClient(client);
      client.connect();
      setPhase({ k: "ready", id: found.engine.id });
    })();
    // No unsubscribe of our own: dispose() drops the client and its callbacks together,
    // and this hook owns the client outright — nobody else holds a reference to it.
    return () => {
      cancelled = true;
      lease.current?.();
      lease.current = null;
      engine.current?.dispose();
      engine.current = undefined;
      setClient(null);
      setConnected(false);
    };
  }, [attempt, engineId]);

  // The document first, THEN the verb. A transport verb sent first plays whatever the engine
  // still had loaded — here, the last module preview — which is a second of the wrong sound
  // before the right one. m9's loadAndPlay orders it the same way, for the same reason.
  const play = useCallback<ModuleEngine["play"]>((doc, fromSeconds) => {
    const client = engine.current;
    if (!client) return;
    // Whatever it complained about last was about the previous document. Cleared here rather
    // than on stop, so a complaint raised BY this send survives to be read.
    setWarning(null);
    client.sendProject(doc);
    // Between the document and the verb: the position belongs to the document just applied,
    // and asking for it after `play` would be heard as a jump. See `play` in the interface
    // for why leaving it to the engine plays silence.
    if (fromSeconds !== undefined) {
      client.seek(fromSeconds);
      setPlayhead(Math.max(0, fromSeconds));
    }
    client.transport("play");
  }, []);

  const stop = useCallback(() => engine.current?.transport("stop"), []);

  const reset = useCallback(() => {
    engine.current?.dropSession();
  }, []);

  // Moved locally as well as sent: the state frame is ~20 Hz, so a playhead that only ever
  // came back from the engine would lag a drag on the waveform by up to 50 ms — long enough
  // to read as the cursor snapping back before it catches up.
  const seek = useCallback((seconds: number) => {
    engine.current?.seek(seconds);
    setPlayhead(Math.max(0, seconds));
  }, []);

  return {
    phase,
    client,
    connected,
    fileBase,
    playing,
    playhead,
    warning,
    outputLevel,
    play,
    stop,
    seek,
    reset,
    retry: () => setAttempt((n) => n + 1),
  };
}
