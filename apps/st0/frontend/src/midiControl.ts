// midiControl.ts — playing a module's params from a MIDI controller, in the BROWSER, because
// that is where the controller is plugged in (the engine's machine may be elsewhere). Reads
// control changes and hands back a 0..1; echoes a value back to the device that sent it when
// that device also has an output. The MAP itself is a file — see @studio/song's controller.ts.

/** Web MIDI's types ship in the DOM lib; only `requestMIDIAccess` is behind a feature check. */
type MidiNavigator = Navigator & {
  requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MIDIAccess>;
};

/** One mapped control: the message to listen for, and the caller's name for what it drives. */
export interface CcRoute {
  ch: number; // 1..16, as the file and a musician count them
  cc: number; // 0..127
  /** Opaque to this module — st0 uses `${module}\u0000${param}`. */
  key: string;
}

/** A control moved: `t` is 0..1, the caller scales it to the param's own range. */
export type CcHandler = (key: string, t: number) => void;

/** What a learn captured. */
export interface LearnedCc {
  ch: number;
  cc: number;
  /** The input port it arrived on — what feedback is paired against. */
  device: string;
}

const STATUS_CC = 0xb0;
const key = (ch: number, cc: number) => `${ch}:${cc}`;

/**
 * The live MIDI control surface.
 *
 * One instance for the app. Routes are replaced wholesale whenever the graph reloads, because
 * the map is part of the graph — there is no incremental state to keep in step.
 */
export class MidiControl {
  private access?: MIDIAccess;
  private routes = new Map<string, CcRoute[]>();
  private learning: ((l: LearnedCc) => void) | null = null;
  private onValue: CcHandler;
  // Which input port last drove each key. Feedback goes back to the port of the SAME NAME, so a
  // motorised fader follows itself and a second controller is not moved by the first.
  private lastInput = new Map<string, string>();
  // The last value sent per key, so a value echoed back to us is not echoed on again.
  private lastSent = new Map<string, number>();

  constructor(onValue: CcHandler) {
    this.onValue = onValue;
  }

  /** Ask for access and attach. False when the browser has no Web MIDI, or the user refused. */
  async init(): Promise<boolean> {
    const nav = navigator as MidiNavigator;
    if (!nav.requestMIDIAccess) return false;
    try {
      this.access = await nav.requestMIDIAccess();
    } catch {
      return false; // refused, or blocked by permissions policy — the app works without it
    }
    this.attach();
    // A controller plugged in mid-session appears here, so re-attach rather than miss it.
    this.access.onstatechange = () => this.attach();
    return true;
  }

  /** Whether MIDI is available at all — what a menu greys itself out on. */
  get ready(): boolean {
    return !!this.access;
  }

  /** Every input port's name, for a status line that says what it is listening to. */
  inputs(): string[] {
    return [...(this.access?.inputs.values() ?? [])].map((i) => i.name ?? "");
  }

  private attach(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values())
      input.onmidimessage = (e) => this.onMessage(e);
  }

  /** Replace the whole map. Called on every graph reload — see the class comment. */
  setRoutes(routes: CcRoute[]): void {
    this.routes = new Map();
    for (const r of routes) {
      const k = key(r.ch, r.cc);
      const at = this.routes.get(k);
      // One control MAY drive several params — a macro. The file forbids the reverse (two
      // controls on one param), which is the direction that is a bug.
      if (at) at.push(r);
      else this.routes.set(k, [r]);
    }
  }

  /**
   * Arm learn: the next control change captures instead of playing. Returns a cancel.
   *
   * Deliberately swallows that one message rather than also actuating: the knob you wiggle to
   * teach it is usually already mapped to something else, and moving that something while
   * assigning is a surprise you cannot undo.
   */
  learn(onLearned: (l: LearnedCc) => void): () => void {
    this.learning = onLearned;
    return () => {
      if (this.learning === onLearned) this.learning = null;
    };
  }

  /** Is a learn armed right now? */
  get learning_(): boolean {
    return this.learning !== null;
  }

  /**
   * Echo a value back to the device that drives `key` — the "bidirectional when possible" half.
   *
   * Possible means: something has driven this key (so we know which device to answer), and that
   * device has an output port of the same name. A controller with no output, or one that has not
   * been touched yet, is simply write-only, and this says so by returning false.
   */
  feedback(k: string, t: number): boolean {
    const route = this.routeFor(k);
    if (!route || !this.access) return false;
    const device = this.lastInput.get(k);
    if (!device) return false;
    const out = [...this.access.outputs.values()].find(
      (o) => (o.name ?? "") === device,
    );
    if (!out) return false;
    const v = Math.max(0, Math.min(127, Math.round(t * 127)));
    // Nothing to say when the device already shows this — and saying it anyway is how a
    // feedback loop starts on a controller that echoes what it receives.
    if (this.lastSent.get(k) === v) return true;
    this.lastSent.set(k, v);
    out.send([STATUS_CC | (route.ch - 1), route.cc, v]);
    return true;
  }

  /** Whether echoing to `key` would reach anything — what the UI reports after a bind. */
  hasFeedback(k: string): boolean {
    const device = this.lastInput.get(k);
    if (!device || !this.access) return false;
    return [...this.access.outputs.values()].some(
      (o) => (o.name ?? "") === device,
    );
  }

  dispose(): void {
    if (this.access) {
      for (const input of this.access.inputs.values())
        input.onmidimessage = null;
      this.access.onstatechange = null;
    }
    this.access = undefined;
    this.routes.clear();
    this.lastInput.clear();
    this.lastSent.clear();
    this.learning = null;
  }

  private routeFor(k: string): CcRoute | undefined {
    for (const list of this.routes.values())
      for (const r of list) if (r.key === k) return r;
    return undefined;
  }

  private onMessage(e: MIDIMessageEvent): void {
    if (!e.data || e.data.length < 3) return;
    const [status, d1, d2] = e.data;
    if ((status & 0xf0) !== STATUS_CC) return; // notes and everything else are not ours
    const ch = (status & 0x0f) + 1;
    const device = (e.target as MIDIInput | null)?.name ?? "";

    if (this.learning) {
      const done = this.learning;
      this.learning = null;
      done({ ch, cc: d1, device });
      return; // swallowed on purpose — see learn()
    }

    const routes = this.routes.get(key(ch, d1));
    if (!routes) return;
    const t = d2 / 127;
    for (const r of routes) {
      this.lastInput.set(r.key, device);
      // What we just received is what the device already shows; recording it stops the next
      // feedback pass from sending it straight back.
      this.lastSent.set(r.key, d2);
      this.onValue(r.key, t);
    }
  }
}

/** The key st0 addresses a binding by. Not a `:` join — a plugin param name may contain one. */
export const ccKey = (module: string, param: string): string =>
  `${module}\u0000${param}`;

/** …and back. */
export function splitCcKey(k: string): { module: string; param: string } {
  const at = k.indexOf("\u0000");
  return at < 0
    ? { module: k, param: "" }
    : { module: k.slice(0, at), param: k.slice(at + 1) };
}
