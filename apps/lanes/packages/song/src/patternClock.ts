// patternClock.ts — stream Strudel patterns live onto engine tracks, locked to the
// transport: a look-ahead scheduler that queries each pattern for the upcoming window
// and schedules its events (module notes / sample one-shots / default 4OSC notes)
// just ahead of the (interpolated) playhead. Full rationale: docs/patternClock.md.

import { loadModuleRefs, loadModules } from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import type { ClipDoc, PluginDoc, ProjectDoc, TrackDoc } from "./project";
import { enginePlugin } from "./project";
import { resolveSample } from "./samples";
import {
  fallbackPitch,
  hapPitch,
  loadPattern,
  type StrudelEvent,
  type StrudelLane,
  type StrudelLink,
  type StrudelPattern,
} from "./strudel";

const TICK_MS = 150;
const LOOKAHEAD_SEC = 1.0; // schedule this far ahead of the playhead
const PRUNE_BEHIND_BEATS = 8; // drop clips older than this once the engine can remove them

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

// A pattern's `.label(...)` -> the id fragment keying its track; the `lbl-` prefix keeps it out of orbit ids.
function labelKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `lbl-${slug || "x"}`;
}

function fourOsc(trackId: string): PluginDoc {
  return {
    id: `${trackId}:4osc`,
    type: "4osc",
    name: "4OSC",
    path: "",
    presetSave: "",
    role: "instrument",
    enabled: true,
    params: {},
  };
}

// A PluginDoc per instrument module, so a pattern's `s("<module>")` plays that plugin instead of the default.
function loadInstruments(dir: string | null): Map<string, PluginDoc> {
  const map = new Map<string, PluginDoc>();
  if (!dir) return map;
  let modules: Record<string, any>;
  let moduleRefs: Record<string, any>;
  try {
    modules = loadModules(dir);
    moduleRefs = loadModuleRefs(dir);
  } catch {
    return map;
  }
  // Resolved first: a module's plugin may come from the one it extends.
  for (const [name, module] of Object.entries<any>(
    resolveModuleMap(modules, moduleRefs),
  )) {
    if (module?.category !== "instruments") continue; // only instrument modules
    const plugin = module.plugin;
    if (!plugin?.type) continue; // a rack instrument (no plugin) is handled elsewhere
    const { type: engType, name: engName } = enginePlugin(plugin, name); // same authoring->engine mapping the node compiler uses
    if (!engType) continue; // internal module missing its xmlTypeName `name`
    map.set(name, {
      id: "", // set per track when built
      type: engType,
      name: engName,
      path: String(module.preset ?? ""),
      presetSave: "",
      role: "instrument",
      enabled: true,
      params: module.params ?? {},
    });
  }
  return map;
}

// How to build a live orbit track. Only UNDECLARED lanes need one — a declared lane already has a compiled track.
interface TrackDef {
  label: string;
  contentType: string;
  group: string; // the group the pattern's undeclared lanes hang under
  plugins: PluginDoc[];
}

// A loaded pattern: the tracks that declared a lane of it (keyed by label slug), plus where its undeclared lanes go.
interface LivePattern {
  pattern: StrudelPattern;
  path: string;
  lanes: Map<string, StrudelLane>; // labelKey(lane.label) -> the declaring track
  group: string;
  key: string;
}

export class PatternClock {
  private base: ProjectDoc | null = null;
  private projectDir: string | null = null;
  private patterns: LivePattern[] = [];
  private instruments = new Map<string, PluginDoc>(); // instrument-module name -> plugin template
  private declared = new Map<string, StrudelLane>(); // declared track id -> its lane
  private defs = new Map<string, TrackDef>(); // live track id -> how to build it
  private clips = new Map<string, ClipDoc[]>(); // track id -> its clips (declared or live)
  private warned = new Set<string>(); // one-shot log keys, so a bad lane isn't spam
  private timer: ReturnType<typeof setInterval> | null = null;
  private clipSeq = 0;
  private scheduledCycle = 0; // the cycle up to which we've already scheduled
  // Playhead interpolation between the engine's ~20 Hz state frames.
  private playing = false;
  private lastPlayheadSec = 0;
  private lastWallMs = 0;

  constructor(
    private send: (doc: ProjectDoc) => void,
    private log: (line: string) => void = () => {},
    private onOrbits: (tracks: TrackDoc[]) => void = () => {}, // reports the live orbit tracks; [] when inactive
  ) {}

  get active(): boolean {
    return this.patterns.length > 0;
  }

  setBaseProject(doc: ProjectDoc): void {
    this.base = doc;
    this.emit();
  }

  // The project changed: clear everything derived from the old one before the new doc arrives (docs/patternClock.md).
  switchTo(projectDir: string | null): void {
    if (projectDir === this.projectDir) return;
    this.projectDir = projectDir;
    this.base = null;
    this.patterns = [];
    this.instruments.clear();
    this.declared.clear();
    this.defs.clear();
    this.clips.clear();
    this.warned.clear();
    this.clipSeq = 0;
    this.scheduledCycle = 0;
    this.playing = false; // re-synced from the engine's next frame — false makes it a (re)start edge, re-anchoring scheduledCycle
    this.lastPlayheadSec = 0;
    this.lastWallMs = 0;
    this.ensureTimer();
    this.onOrbits([]);
  }

  // `links` are the patterns the strudel tracks point at, each carrying the tracks that declared one of its lanes.
  async refreshPatterns(
    links: StrudelLink[],
    projectDir: string | null,
  ): Promise<void> {
    const hadPatterns = this.active; // guards a redundant re-send when nothing is (or was) active — see docs/patternClock.md
    this.projectDir = projectDir;
    this.instruments = loadInstruments(projectDir);
    const loaded: LivePattern[] = [];
    for (const { path, lanes, group, key } of links) {
      try {
        loaded.push({
          pattern: await loadPattern(path),
          path,
          lanes: new Map(lanes.map((l) => [labelKey(l.label), l])),
          group,
          key,
        });
      } catch (e) {
        this.log(
          `strudel: ${path.replace(/^.*[\\/]/, "")} — ${(e as Error).message}`,
        );
      }
    }
    this.patterns = loaded;
    this.declared = new Map();
    for (const p of loaded)
      for (const lane of p.lanes.values()) this.declared.set(lane.track, lane);
    // Pre-create the tracks each orbit will use, so an instrument add's rebuild prepares them before playback starts.
    for (const p of loaded)
      for (const e of p.pattern.query(0, 8)) this.resolve(e, p);
    this.reportUnclaimed(loaded);
    this.ensureTimer();
    if (hadPatterns || this.active) this.emit(); // patterns now (fold in) or before (send cleaned base) — else already sent, see hadPatterns
    if (loaded.length)
      this.log(
        `strudel: ${loaded.length} pattern(s) · ${this.declared.size} declared · ${this.defs.size} live track(s)`,
      );
  }

  // A track can name a lane its pattern lacks; only evaluation can tell, so report it rather than look broken.
  private reportUnclaimed(loaded: LivePattern[]): void {
    for (const p of loaded) {
      const seen = new Map<string, string>(); // key -> the label as the pattern spells it
      for (const e of p.pattern.query(0, 8))
        if (e.label) seen.set(labelKey(e.label), e.label);
      const missing = [...p.lanes.values()].filter(
        (l) => !seen.has(labelKey(l.label)),
      );
      if (!missing.length) continue;
      const file = p.path.replace(/^.*[\\/]/, "");
      const have =
        [...seen.values()]
          .sort()
          .map((l) => `'${l}'`)
          .join(", ") || "none";
      for (const l of missing)
        this.log(
          `strudel: track '${l.track}' wants lane '${l.label}' but ${file} has no such label (labels: ${have})`,
        );
    }
  }

  onState(playing: boolean, playheadSec: number): void {
    if (playing && !this.playing)
      this.scheduledCycle = this.cycleAt(playheadSec); // (re)start: schedule from now
    this.playing = playing;
    this.lastPlayheadSec = playheadSec;
    this.lastWallMs = Date.now();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // --- internals ---
  // Route an event and decide how it sounds (note, sample, or nothing). See docs/patternClock.md.
  private resolve(
    e: StrudelEvent,
    p: LivePattern,
  ): { trackId: string; note?: number; sample?: string } | null {
    const s = e.s;
    const lane = e.label ? p.lanes.get(labelKey(e.label)) : undefined;

    // A declared lane: contentType settles how the event reads, so pattern and chain can't disagree.
    if (lane) {
      if (lane.contentType !== "audio")
        return {
          trackId: lane.track,
          note: hapPitch(e.note, e.n) ?? (s ? fallbackPitch(s) : 60),
        };
      const src = s ? resolveSample(this.projectDir, s, e.n ?? 0) : null;
      if (src) return { trackId: lane.track, sample: src };
      // Dropping an unresolvable sample is right, but do it OUT LOUD once per sound, or a typo'd name is just silence.
      const key = `${lane.track}:${s ?? ""}`;
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.log(
          `strudel: track '${lane.track}' is an audio lane but ${s ? `no sample matches '${s}'` : "an event names no sound"} — skipped`,
        );
      }
      return null;
    }

    // 1. a project instrument module → a note on that instrument's own track
    if (s && this.instruments.has(s)) {
      const trackId = this.claim(
        e,
        p,
        `${s}-${e.orbit}`,
        `strudel ${e.orbit} ${s}`,
        "notes",
        (id) => [{ ...this.instruments.get(s)!, id: `${id}:inst` }],
      );
      return { trackId, note: hapPitch(e.note, e.n) ?? 60 };
    }
    // 2. a resolvable sample name → a one-shot audio clip on the sample track
    if (s) {
      const src = resolveSample(this.projectDir, s, e.n ?? 0);
      if (src) {
        const trackId = this.claim(
          e,
          p,
          `smp-${e.orbit}`,
          `strudel ${e.orbit} smp`,
          "audio",
          () => [],
        );
        return { trackId, sample: src };
      }
    }
    // 3. default → a 4OSC note (explicit pitch, else a fallback blip for a bare sound)
    const trackId = this.claim(
      e,
      p,
      `orbit-${e.orbit}`,
      `strudel ${e.orbit}`,
      "notes",
      (id) => [fourOsc(id)],
    );
    return {
      trackId,
      note: hapPitch(e.note, e.n) ?? (s ? fallbackPitch(s) : 60),
    };
  }

  // Pick (or register) the id of the live track an UNDECLARED event lands on — see docs/patternClock.md.
  private claim(
    e: StrudelEvent,
    p: LivePattern,
    orbitKey: string,
    orbitLabel: string,
    contentType: string,
    plugins: (trackId: string) => PluginDoc[],
  ): string {
    if (e.label) {
      const id = `strudel-${p.key}-${labelKey(e.label)}`;
      const existing = this.defs.get(id);
      if (!existing) {
        this.defs.set(id, {
          label: e.label,
          contentType,
          group: p.group,
          plugins: plugins(id),
        });
        return id;
      }
      if (existing.contentType === contentType) return id;
    }
    const id = `strudel-${p.key}-${orbitKey}`;
    if (!this.defs.has(id))
      this.defs.set(id, {
        label: orbitLabel,
        contentType,
        group: p.group,
        plugins: plugins(id),
      });
    return id;
  }

  private beatsPerCycle(): number {
    const num = this.base?.timeSigNumerator || 4;
    const den = this.base?.timeSigDenominator || 4;
    return num * (4 / den); // Tidal convention: 1 cycle = 1 bar
  }
  private nowSec(): number {
    return this.playing
      ? this.lastPlayheadSec + (Date.now() - this.lastWallMs) / 1000
      : this.lastPlayheadSec;
  }
  private cycleAt(sec: number): number {
    const tempo = this.base?.tempo || 120;
    return (sec * (tempo / 60)) / this.beatsPerCycle();
  }

  private ensureTimer(): void {
    if (this.active && !this.timer)
      this.timer = setInterval(() => this.tick(), TICK_MS);
    else if (!this.active && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (!this.active || !this.base) return;
    const bpc = this.beatsPerCycle();
    const nowBeat = this.cycleAt(this.nowSec()) * bpc;

    let pruned = false; // prune already-played clips
    for (const [id, list] of this.clips) {
      const kept = list.filter(
        (c) => c.start + c.length >= nowBeat - PRUNE_BEHIND_BEATS,
      );
      if (kept.length !== list.length) {
        this.clips.set(id, kept);
        pruned = true;
      }
    }

    if (this.playing) {
      const cps = this.base.tempo / 60 / bpc;
      const from = this.scheduledCycle;
      const to = this.cycleAt(this.nowSec()) + LOOKAHEAD_SEC * cps;
      if (to > from) {
        const startBeat = from * bpc;
        const midiNotes = new Map<string, ClipDoc["notes"]>(); // note-track id -> notes for this window
        for (const p of this.patterns) {
          for (const e of p.pattern.query(from, to)) {
            const r = this.resolve(e, p);
            if (!r) continue; // nothing to play (see resolve)
            if (r.sample) {
              pushTo(this.clips, r.trackId, {
                id: `smp-${this.clipSeq++}`,
                type: "audio",
                name: "",
                source: r.sample,
                start: e.cycle * bpc,
                length: 0, // natural one-shot
                offset: 0,
                fadeIn: 0,
                fadeOut: 0,
                loopStart: 0,
                loopEnd: 0,
                notes: [],
              });
            } else {
              pushTo(midiNotes, r.trackId, {
                time: e.cycle * bpc - startBeat,
                duration: e.dur * bpc,
                key: r.note!,
                vel: e.vel,
                channel: 0,
                rel: 1,
              });
            }
          }
        }
        for (const [trackId, notes] of midiNotes) {
          if (!notes.length) continue;
          pushTo(this.clips, trackId, {
            id: `${trackId}-${this.clipSeq++}`,
            type: "midi",
            name: "",
            source: "",
            start: startBeat,
            length: (to - from) * bpc,
            offset: 0,
            fadeIn: 0,
            fadeOut: 0,
            loopStart: 0,
            loopEnd: 0,
            notes,
          });
        }
        this.scheduledCycle = to;
        this.emit();
        return;
      }
    }
    if (pruned) this.emit();
  }

  private buildTrack(id: string): TrackDoc {
    const def = this.defs.get(id)!;
    return {
      id,
      name: def.label,
      role: "regular",
      contentType: def.contentType,
      group: def.group,
      generated: true, // the pattern streams this lane; no clips can be authored on it
      inputChannels: [], // the pattern is the source here, not the interface
      monitor: "auto",
      inputGain: 0, // a generated lane has no interface input to trim
      color: "",
      mute: false,
      solo: false,
      disabled: false,
      clips: this.clips.get(id) ?? [],
      plugins: def.plugins,
      sends: [],
      automation: [],
    };
  }

  // The doc the engine gets: base, declared lanes filled, a live track per undeclared lane. See docs/patternClock.md.
  private emit(): void {
    if (!this.base) return;
    if (!this.active) {
      this.onOrbits([]);
      this.send(this.base);
      return;
    }
    const liveTracks = [...this.defs.keys()]
      .sort()
      .map((id) => this.buildTrack(id));
    const tracks = this.base.tracks.map((t) =>
      this.declared.has(t.id) ? { ...t, clips: this.clips.get(t.id) ?? [] } : t,
    );
    this.onOrbits(liveTracks); // surfaces list lanes NOT in the project's own tracks; a declared one already is
    this.send({ ...this.base, tracks: [...tracks, ...liveTracks] });
  }
}
