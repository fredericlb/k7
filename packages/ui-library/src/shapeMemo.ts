// shapeMemo.ts — the last few song shapes read this tab, keyed by the audio's path, with
// listeners: the bar at the bottom learns of a shape the song pane's analysis just produced
// without asking for one itself. Bounded, since an envelope is thousands of numbers.
// See ../docs/miniPlayer.md, "The waveform in the bar".

export class Memo<T> {
  private items = new Map<string, T>();
  private listeners = new Set<() => void>();

  constructor(private readonly keep: number) {}

  get = (key: string): T | undefined => this.items.get(key);

  has = (key: string): boolean => this.items.has(key);

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** Store `value` as the freshest, dropping the stalest past `keep`, and tell every listener. */
  set(key: string, value: T): void {
    this.items.delete(key);
    this.items.set(key, value);
    while (this.items.size > this.keep) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
    for (const fn of this.listeners) fn();
  }
}
