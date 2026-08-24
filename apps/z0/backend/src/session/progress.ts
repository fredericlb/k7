import type { Category, OrderEntry, Session, Song } from "./model.ts";

// The play-order machine: a category intro, then its songs, then the next slot's intro.

/** Lightweight preview of what the next item will be. */
export interface PeekInfo {
  type: "category" | "song" | "end";
  categoryName?: string;
  songArtist?: string;
  songTitle?: string;
  mode?: string;
  finished: boolean;
}

/** What /next returns: a category intro or a song. */
export interface NextItem {
  type: "category" | "song" | "end";
  category?: Category;
  song?: Song;
  categoryName?: string;
  mode?: string;
  finished: boolean;
}

/** A valid empty Session — boot placeholder until the operator picks one. */
export function emptySession(): Session {
  return { categories: [] };
}

function pauseCategory(): Category {
  return { name: "Pause", mode: "pause", illustration: "", songs: [] };
}

export class SessionProgress {
  session: Session;
  private orderIndex = 0;
  /** -1 = slot intro not sent yet, 0 = intro sent, k = k songs sent. */
  private songIndex = -1;
  private started = false;
  private finished = false;

  constructor(session: Session) {
    this.session = session;
  }

  /** The session's guest password, or "" if none. */
  guestPassword(): string {
    return this.session.guestPassword ?? "";
  }

  private findCategory(name: string): Category | null {
    return this.session.categories.find((c) => c.name === name) ?? null;
  }

  /** The session's own order, or one synthesized entry per category when it has none. */
  private effectiveOrder(): OrderEntry[] {
    if (this.session.order && this.session.order.length > 0)
      return this.session.order;
    return this.session.categories.map((cat) => ({ cat: cat.name }));
  }

  /** An entry as a playable slot: a pause, or a category sliced by its from/to. */
  private resolveSlot(entry: OrderEntry): {
    isPause: boolean;
    cat: Category | null;
    songs: Song[];
  } {
    if (entry.type === "pause") return { isPause: true, cat: null, songs: [] };
    const cat = this.findCategory(entry.cat ?? "");
    if (!cat) return { isPause: false, cat: null, songs: [] };
    const all = cat.songs;
    let from = 0;
    let to = all.length;
    if (entry.from !== undefined && entry.from >= 0 && entry.from <= all.length)
      from = entry.from;
    if (entry.to !== undefined && entry.to >= 0 && entry.to <= all.length)
      to = entry.to;
    if (from > to) from = to;
    return { isPause: false, cat, songs: all.slice(from, to) };
  }

  /** Advance orderIndex to the next pause or non-empty slot; false = done. */
  private advanceToPlayableSlot(): boolean {
    const order = this.effectiveOrder();
    while (this.orderIndex < order.length) {
      const { isPause, songs } = this.resolveSlot(order[this.orderIndex]);
      if (isPause || songs.length > 0) return true;
      this.orderIndex++;
    }
    return false;
  }

  private categoryIntro(
    isPause: boolean,
    cat: Category | null,
    songs: Song[],
  ): NextItem {
    if (isPause || !cat) {
      const p = pauseCategory();
      return {
        type: "category",
        category: p,
        categoryName: p.name,
        mode: p.mode,
        finished: false,
      };
    }
    return {
      type: "category",
      category: { ...cat, songs },
      categoryName: cat.name,
      mode: cat.mode,
      finished: false,
    };
  }

  /** Current item without advancing; null before the session starts. */
  current(): NextItem | null {
    if (!this.started) return null;
    if (this.finished) return { type: "end", finished: true };

    const order = this.effectiveOrder();
    if (this.orderIndex >= order.length) return { type: "end", finished: true };

    const { isPause, cat, songs } = this.resolveSlot(order[this.orderIndex]);

    if (this.songIndex === 0) return this.categoryIntro(isPause, cat, songs);
    if (isPause) return null; // shouldn't happen — pause slots have no songs

    const idx = this.songIndex - 1;
    if (idx < 0 || idx >= songs.length) return null;
    return {
      type: "song",
      song: songs[idx],
      categoryName: cat?.name,
      mode: cat?.mode,
      finished: false,
    };
  }

  isStarted(): boolean {
    return this.started;
  }

  /** Progression indices for persistence. */
  snapshot(): {
    orderIndex: number;
    songIndex: number;
    started: boolean;
    finished: boolean;
  } {
    return {
      orderIndex: this.orderIndex,
      songIndex: this.songIndex,
      started: this.started,
      finished: this.finished,
    };
  }

  /** Overwrite the progression indices from a persisted snapshot. */
  restore(
    orderIndex: number,
    songIndex: number,
    started: boolean,
    finished: boolean,
  ): void {
    this.orderIndex = orderIndex;
    this.songIndex = songIndex;
    this.started = started;
    this.finished = finished;
  }

  /** Advance to the next item (category intro → its songs → next slot → end). */
  next(): NextItem {
    if (this.finished) return { type: "end", finished: true };

    // First call into a slot (or first call ever): emit the intro.
    if (this.songIndex === -1) {
      this.started = true;
      if (!this.advanceToPlayableSlot()) {
        this.finished = true;
        return { type: "end", finished: true };
      }
      const { isPause, cat, songs } = this.resolveSlot(
        this.effectiveOrder()[this.orderIndex],
      );
      this.songIndex = 0;
      return this.categoryIntro(isPause, cat, songs);
    }

    let { isPause, cat, songs } = this.resolveSlot(
      this.effectiveOrder()[this.orderIndex],
    );

    // Emit next song in the current slot.
    if (!isPause && this.songIndex - 1 < songs.length - 1) {
      this.songIndex++;
      return {
        type: "song",
        song: songs[this.songIndex - 1],
        categoryName: cat?.name,
        mode: cat?.mode,
        finished: false,
      };
    }

    // Current slot exhausted: advance and emit the next slot's intro.
    this.orderIndex++;
    if (!this.advanceToPlayableSlot()) {
      this.finished = true;
      return { type: "end", finished: true };
    }
    ({ isPause, cat, songs } = this.resolveSlot(
      this.effectiveOrder()[this.orderIndex],
    ));
    this.songIndex = 0;
    return this.categoryIntro(isPause, cat, songs);
  }

  /** Playable songs across all slots (after slicing). */
  totalSongs(): number {
    let total = 0;
    for (const entry of this.effectiveOrder()) {
      const { isPause, songs } = this.resolveSlot(entry);
      if (!isPause) total += songs.length;
    }
    return total;
  }

  /** Songs of the current slot (for preloading on resume). */
  currentCategorySongs(): Song[] {
    if (!this.started || this.finished) return [];
    const order = this.effectiveOrder();
    if (this.orderIndex >= order.length) return [];
    return this.resolveSlot(order[this.orderIndex]).songs;
  }

  /** Jump to the next slot, so the following next() emits its intro; false once finished. */
  skipToNextCategory(): boolean {
    if (this.finished) return false;
    const order = this.effectiveOrder();
    this.orderIndex++;
    this.songIndex = -1;
    if (this.orderIndex >= order.length) {
      this.finished = true;
      return false;
    }
    return true;
  }

  /** Preview what the next next() would return, without advancing. */
  peek(): PeekInfo {
    if (this.finished) return { type: "end", finished: true };

    const order = this.effectiveOrder();

    // At a slot boundary: preview the next playable slot's intro.
    if (!this.started || this.songIndex === -1) {
      for (let oi = this.orderIndex; oi < order.length; oi++) {
        const { isPause, cat, songs } = this.resolveSlot(order[oi]);
        if (isPause) {
          const p = pauseCategory();
          return {
            type: "category",
            categoryName: p.name,
            mode: p.mode,
            finished: false,
          };
        }
        if (songs.length > 0) {
          return {
            type: "category",
            categoryName: cat!.name,
            mode: cat!.mode,
            finished: false,
          };
        }
      }
      return { type: "end", finished: true };
    }

    if (this.orderIndex >= order.length) return { type: "end", finished: true };
    const { isPause, cat, songs } = this.resolveSlot(order[this.orderIndex]);

    // Inside a category slot with songs remaining.
    if (!isPause && this.songIndex - 1 < songs.length - 1) {
      const song = songs[this.songIndex];
      let artist = song.artist;
      let title = song.title;
      if (song.tracks && song.tracks.length > 0 && artist === "") {
        artist = song.tracks[0].artist ?? "";
        title = song.tracks[0].title ?? "";
      }
      return {
        type: "song",
        categoryName: cat!.name,
        songArtist: artist,
        songTitle: title,
        mode: cat!.mode,
        finished: false,
      };
    }

    // End of current slot: preview the next playable slot.
    for (let oi = this.orderIndex + 1; oi < order.length; oi++) {
      const { isPause: p, cat: c, songs: s } = this.resolveSlot(order[oi]);
      if (p) {
        const pc = pauseCategory();
        return {
          type: "category",
          categoryName: pc.name,
          mode: pc.mode,
          finished: false,
        };
      }
      if (s.length > 0) {
        return {
          type: "category",
          categoryName: c!.name,
          mode: c!.mode,
          finished: false,
        };
      }
    }
    return { type: "end", finished: true };
  }
}
