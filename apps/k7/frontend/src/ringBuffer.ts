// ringBuffer.ts — a fixed-capacity buffer of numbers that drops its OLDEST value when full, in
// O(1) per push. An array's `shift()` is O(n), and at the engine's 20 Hz over a ten-minute take
// that was the cost of every frame. `toArray` is the one O(n) read, paid by whoever draws.

export class RingBuffer {
  private readonly data: Float64Array;
  private start = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    this.data = new Float64Array(Math.max(1, capacity));
  }

  get length(): number {
    return this.size;
  }

  push(v: number): void {
    const cap = this.data.length;
    if (this.size < cap) {
      this.data[(this.start + this.size) % cap] = v;
      this.size++;
    } else {
      this.data[this.start] = v;
      this.start = (this.start + 1) % cap;
    }
  }

  clear(): void {
    this.start = 0;
    this.size = 0;
  }

  /** The values oldest first, as a fresh array — what a waveform memoises on. */
  toArray(): number[] {
    const out = new Array<number>(this.size);
    const cap = this.data.length;
    for (let i = 0; i < this.size; i++)
      out[i] = this.data[(this.start + i) % cap];
    return out;
  }
}
