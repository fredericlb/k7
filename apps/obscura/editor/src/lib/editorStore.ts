import { useSyncExternalStore } from "react";
import { m } from "../paraglide/messages.js";
import { f } from "./api";

// Framework-free port of EditorView.vue's script block: the Grist-backed
// editor state machine (load → edit → autosave). Talks to /api/editor/*
// exclusively.
//
// Wire ids are strings. Existing rows carry their stringified Grist id
// (e.g. "456"); newly-created rows carry a request-local "new-..." token
// the backend resolves while reconciling. RefList fields are arrays of
// these strings, so a new song can already reference a freshly-spawned
// track without a roundtrip.
//
// Reactivity: Vue deep-watched the loaded subtree to trigger autosave. React
// has no equivalent, so every mutation funnels through mutate(), which bumps
// a version counter (the useSyncExternalStore snapshot — components read the
// live fields off the store) AND schedules the debounced save. touch() is the
// same minus the save, for selection/UI-only changes. Objects stay mutable so
// input bindings keep their identity and the operator never loses a cursor.

export type EntityRef = string; // numeric for existing rows, "new-foo-1" for fresh

export interface OrderEntry {
  id: EntityRef;
  type: string; // "cat" | "pause"
  categoryId?: EntityRef;
  start?: number | null;
  end?: number | null;
}
export interface Category {
  id: EntityRef;
  name: string;
  mode: string;
  notice: string;
  illustration: string;
  trackType: string;
  liveOnly: boolean;
  songIds: EntityRef[];
}
export interface Song {
  id: EntityRef;
  label: string;
  status: string;
  answer: string;
  liveOnly: boolean;
  effects: Record<string, number>;
  trackIds: EntityRef[];
  // Backend-supplied first-track preview — used by the library picker
  // (which doesn't have local Tracks) to render the "{answer} - {artist}
  // - {title}" label without an extra fetch. Optional because older
  // payloads from a stale backend won't include it.
  firstArtist?: string;
  firstTitle?: string;
}
export interface Track {
  id: EntityRef;
  artist: string;
  title: string;
  type: string;
  start: number;
  end: number;
  youtubeId: string;
  audioRowId: number;
  hasAudio: boolean;
}
interface SessionPayload {
  id: number;
  name: string;
  guestPassword: string;
  order: OrderEntry[];
  categories: Category[];
  songs: Song[];
  tracks: Track[];
}
export interface SessionStub {
  id: number;
  name: string;
}

export type LibraryKind = "categories" | "songs" | "tracks";
export type LibraryRow = Category | Song | Track;

export const EFFECT_KEYS = [
  "speed",
  "pitch",
  "pitchvar",
  "chorus",
  "lowpass",
  "highpass",
  "bitreduction",
  "overdrive",
  "phaser",
];

const AUTOSAVE_DELAY_MS = 1000;

// foldForSearch lowercases AND strips diacritics so a typed "edith" matches
// "Édith Piaf". NFD splits each accented char into base + combining mark;
// \p{Diacritic} then erases the marks.
function foldForSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export class EditorStore {
  // ─── State ────────────────────────────────────────────────────────────
  sessions: SessionStub[] = [];
  loadedSessionId: number | null = null;
  loadError = "";
  saveStatus: "idle" | "saving" | "saved" | "error" = "idle";
  saveMessage = "";

  // Loaded session subtree — flat arrays mirroring the backend response.
  order: OrderEntry[] = [];
  categories: Category[] = [];
  songs: Song[] = [];
  tracks: Track[] = [];
  sessionName = "";
  guestPassword = "";

  // Selection state. The right-hand area is a fixed three-column view
  // (category → song → track), so we track each axis independently. `view`
  // switches the right area between the three-column tree and the
  // full-width session attrs panel (toggled via the SESSION row).
  view: "session" | "tree" = "session";
  selectedCategoryId: EntityRef | null = null;
  selectedSongId: EntityRef | null = null;
  selectedTrackId: EntityRef | null = null;

  // Library picker modal state.
  libraryOpen = false;
  libraryKind: LibraryKind = "categories";
  libraryItems: LibraryRow[] = [];
  libraryLoading = false;
  libraryFilter = "";
  // onPick(rowId) is set when the modal opens; receiving the picked id wires
  // the library row into whichever parent triggered the modal.
  private onPick: ((rowId: EntityRef) => void) | null = null;

  // Audio upload (selected track).
  uploadState: "idle" | "uploading" | "ok" | "error" = "idle";
  uploadMessage = "";

  private version = 0;
  private listeners = new Set<() => void>();

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** UI-only change: re-render, no save. */
  touch = (): void => this.emit();

  /** Data change: re-render AND schedule the debounced autosave. */
  mutate = (fn?: () => void): void => {
    fn?.();
    this.emit();
    this.scheduleAutoSave();
  };

  // ─── Temp id factory ──────────────────────────────────────────────────
  private tempCounter = 0;
  private makeTempID(prefix: string): EntityRef {
    this.tempCounter++;
    return `new-${prefix}-${this.tempCounter}`;
  }

  // ─── Lookups ──────────────────────────────────────────────────────────
  categoryById(id: EntityRef): Category | undefined {
    return this.categories.find((c) => c.id === id);
  }
  songById(id: EntityRef): Song | undefined {
    return this.songs.find((s) => s.id === id);
  }
  trackById(id: EntityRef): Track | undefined {
    return this.tracks.find((tk) => tk.id === id);
  }

  get selectedCategory(): Category | null {
    return this.selectedCategoryId
      ? (this.categoryById(this.selectedCategoryId) ?? null)
      : null;
  }
  get selectedSong(): Song | null {
    return this.selectedSongId
      ? (this.songById(this.selectedSongId) ?? null)
      : null;
  }
  get selectedTrack(): Track | null {
    return this.selectedTrackId
      ? (this.trackById(this.selectedTrackId) ?? null)
      : null;
  }

  // ─── Selection ────────────────────────────────────────────────────────
  selectCategory = (id: EntityRef): void => {
    this.view = "tree";
    if (this.selectedCategoryId !== id) {
      this.selectedCategoryId = id;
      // Switching categories invalidates the downstream selection — the
      // previously-picked song probably doesn't live under this category.
      this.selectedSongId = null;
      this.selectedTrackId = null;
    }
    this.touch();
  };
  selectSong = (id: EntityRef): void => {
    this.view = "tree";
    if (this.selectedSongId !== id) {
      this.selectedSongId = id;
      this.selectedTrackId = null;
    }
    this.touch();
  };
  selectTrack = (id: EntityRef): void => {
    this.view = "tree";
    this.selectedTrackId = id;
    this.touch();
  };
  selectSession = (): void => {
    this.view = "session";
    this.touch();
  };

  // ─── HTTP ─────────────────────────────────────────────────────────────
  async fetchSessions(): Promise<void> {
    try {
      const r = await f("/api/editor/sessions", { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = (await r.json()) as { sessions: SessionStub[] };
      this.sessions = data.sessions ?? [];
    } catch (e) {
      this.loadError = `list sessions: ${(e as Error).message}`;
    }
    this.touch();
  }

  async loadSession(id: number): Promise<void> {
    this.loadError = "";
    this.saveStatus = "idle";
    this.saveMessage = "";
    // Cancel any debounced save left over from the previous session, and
    // suspend autosave while we replay the backend's snapshot so the
    // assignments below don't bounce right back as a "change".
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.suspendAutoSave = true;
    try {
      const r = await f(`/api/editor/sessions/${id}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const s = (await r.json()) as SessionPayload;
      this.sessionName = s.name;
      this.guestPassword = s.guestPassword ?? "";
      // Ids come back as numbers server-side; we work in strings client-side.
      this.order = (s.order ?? []).map((o) => ({
        ...o,
        id: String(o.id),
        categoryId: o.categoryId != null ? String(o.categoryId) : undefined,
      }));
      this.categories = (s.categories ?? []).map((c) => ({
        ...c,
        id: String(c.id),
        songIds: (c.songIds ?? []).map(String),
      }));
      this.songs = (s.songs ?? []).map((sg) => ({
        ...sg,
        id: String(sg.id),
        trackIds: (sg.trackIds ?? []).map(String),
        effects: sg.effects ?? {},
      }));
      this.tracks = (s.tracks ?? []).map((tk) => ({
        ...tk,
        id: String(tk.id),
      }));
      this.loadedSessionId = s.id;
      this.view = "session";
      this.selectedCategoryId = null;
      this.selectedSongId = null;
      this.selectedTrackId = null;
    } catch (e) {
      this.loadError = `load: ${(e as Error).message}`;
    } finally {
      this.suspendAutoSave = false;
      this.touch();
    }
  }

  async saveSession(): Promise<void> {
    if (this.loadedSessionId == null) return;
    this.saveStatus = "saving";
    this.saveMessage = "";
    this.touch();
    try {
      const body = {
        name: this.sessionName,
        guestPassword: this.guestPassword,
        order: this.order.map((o) => ({
          id: o.id.startsWith("new-") ? "" : o.id,
          type: o.type,
          categoryId: o.categoryId,
          start: o.start ?? null,
          end: o.end ?? null,
        })),
        categories: this.categories.map((c) => ({
          id: c.id,
          name: c.name,
          mode: c.mode,
          notice: c.notice,
          illustration: c.illustration,
          trackType: c.trackType,
          liveOnly: c.liveOnly,
          songIds: c.songIds,
        })),
        songs: this.songs.map((s) => ({
          id: s.id,
          label: s.label,
          status: s.status,
          answer: s.answer,
          liveOnly: s.liveOnly,
          effects: s.effects,
          trackIds: s.trackIds,
        })),
        tracks: this.tracks.map((tk) => ({
          id: tk.id,
          artist: tk.artist,
          title: tk.title,
          type: tk.type,
          start: tk.start,
          end: tk.end,
          youtubeId: tk.youtubeId,
          audioRowId: tk.audioRowId,
        })),
      };
      const r = await f(`/api/editor/sessions/${this.loadedSessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `${r.status} ${r.statusText}`);
      }
      const result = (await r.json()) as {
        ok: boolean;
        orphanCount?: number;
        createdCount?: number;
        warning?: string;
        idMap?: Record<string, number>;
      };
      // Patch temp ids to their freshly-minted Grist ids in place. Avoids a
      // full reload — keeping cursor focus stable while the operator keeps
      // typing — at the cost of trusting the backend's idMap.
      if (result.idMap) this.patchTempIDs(result.idMap);
      this.saveStatus = "saved";
      this.saveMessage = result.warning
        ? m["editor.autosave.savedWarning"]({ warning: result.warning })
        : m["editor.autosave.saved"]();
    } catch (e) {
      this.saveStatus = "error";
      this.saveMessage = (e as Error).message;
    }
    this.touch();
  }

  // patchTempIDs walks the loaded subtree and replaces every "new-…" temp id
  // with the real Grist row id the backend reported in its save response.
  // Mutates the existing objects in place so input bindings stay attached
  // and the operator doesn't lose their cursor mid-keystroke.
  private patchTempIDs(idMap: Record<string, number>): void {
    const remap: Record<string, string> = {};
    for (const [k, v] of Object.entries(idMap)) remap[k] = String(v);
    const map = (s: string) => remap[s] ?? s;
    this.suspendAutoSave = true;
    try {
      for (const tk of this.tracks) tk.id = map(tk.id);
      for (const sg of this.songs) {
        sg.id = map(sg.id);
        sg.trackIds = sg.trackIds.map(map);
      }
      for (const c of this.categories) {
        c.id = map(c.id);
        c.songIds = c.songIds.map(map);
      }
      for (const o of this.order) {
        o.id = map(o.id);
        if (o.categoryId) o.categoryId = map(o.categoryId);
      }
      if (this.selectedCategoryId)
        this.selectedCategoryId = map(this.selectedCategoryId);
      if (this.selectedSongId) this.selectedSongId = map(this.selectedSongId);
      if (this.selectedTrackId)
        this.selectedTrackId = map(this.selectedTrackId);
    } finally {
      this.suspendAutoSave = false;
    }
  }

  // ─── Auto-save ────────────────────────────────────────────────────────
  // On any mutation, debounce a save by AUTOSAVE_DELAY_MS so a flurry of
  // keystrokes collapses into one round-trip.
  //
  // Concurrency model:
  //   - saveTail is a Promise that resolves when the last queued save has
  //     completed. queueSave() appends a save to the tail, so concurrent
  //     triggers serialize naturally — Grist only ever sees one save at a
  //     time, which keeps temp-id reconciliation deterministic.
  //   - coalesce is true between "save queued" and "save body picked up";
  //     repeat queueSave() calls during that window collapse onto the same
  //     upcoming save, which is what we want when the operator is mid-burst.
  //
  // suspendAutoSave guards the programmatic mutations done by loadSession
  // and patchTempIDs so we don't echo the backend's own data right back.
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTail: Promise<void> = Promise.resolve();
  private coalesce = false;
  private suspendAutoSave = false;

  private scheduleAutoSave(): void {
    if (this.loadedSessionId == null || this.suspendAutoSave) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.queueSave();
    }, AUTOSAVE_DELAY_MS);
  }

  private queueSave(): void {
    if (this.coalesce) return;
    this.coalesce = true;
    this.saveTail = this.saveTail.then(async () => {
      this.coalesce = false;
      if (this.loadedSessionId == null) return;
      try {
        await this.saveSession();
      } catch {
        // saveSession already surfaced the error on saveStatus/saveMessage;
        // swallow here so a single failure doesn't poison the chain.
      }
    });
  }

  // flushPendingSave forces any debounced edits onto the wire and waits for
  // every queued save to drain. Call before actions that read Grist behind
  // the operator's back (duplicate, change-session) so we don't snapshot a
  // stale view of the session.
  async flushPendingSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.queueSave();
    }
    await this.saveTail;
  }

  changeSession = async (): Promise<void> => {
    await this.flushPendingSave();
    this.loadedSessionId = null;
    this.touch();
  };

  // ─── Create new session ───────────────────────────────────────────────
  // Spawns an empty Session row (no order, no categories) and loads it so
  // the operator can build it up via the regular flow. Asks for the name up
  // front; on success refreshes the picker and selects the new session.
  createSession = async (): Promise<void> => {
    const newName = window.prompt(m["editor.createPrompt"](), "");
    if (!newName || !newName.trim()) return;
    this.saveStatus = "saving";
    this.saveMessage = "";
    this.touch();
    try {
      const r = await f(`/api/editor/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `${r.status} ${r.statusText}`);
      }
      const data = (await r.json()) as { id: number; name: string };
      this.saveStatus = "saved";
      this.saveMessage = `created → #${data.id}`;
      await this.fetchSessions();
      await this.loadSession(data.id);
    } catch (e) {
      this.saveStatus = "error";
      this.saveMessage = m["editor.createFailed"]({
        message: (e as Error).message,
      });
      this.touch();
    }
  };

  // ─── Duplicate session ────────────────────────────────────────────────
  // Light copy: backend clones the Session row, its OrderEntries, and the
  // Categories those entries reference. Songs and Tracks are NOT cloned —
  // the new categories share the same library rows. Asks for the new name
  // up front; on success refreshes the picker and loads the duplicate.
  duplicateSession = async (): Promise<void> => {
    if (this.loadedSessionId == null) return;
    const defaultName = m["editor.duplicateDefault"]({
      name: this.sessionName || "session",
    });
    const newName = window.prompt(m["editor.duplicatePrompt"](), defaultName);
    if (!newName || !newName.trim()) return;
    // Drain any in-flight auto-save first so the duplicate clones the
    // operator's latest edits, not the previous snapshot.
    await this.flushPendingSave();
    this.saveStatus = "saving";
    this.saveMessage = "";
    this.touch();
    try {
      const r = await f(
        `/api/editor/sessions/${this.loadedSessionId}/duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: newName.trim() }),
        },
      );
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `${r.status} ${r.statusText}`);
      }
      const data = (await r.json()) as { id: number; name: string };
      this.saveStatus = "saved";
      this.saveMessage = `duplicated → #${data.id}`;
      await this.fetchSessions();
      await this.loadSession(data.id);
    } catch (e) {
      this.saveStatus = "error";
      this.saveMessage = m["editor.duplicateFailed"]({
        message: (e as Error).message,
      });
      this.touch();
    }
  };

  // ─── Library modal ────────────────────────────────────────────────────
  private async openLibrary(
    kind: LibraryKind,
    picker: (id: EntityRef) => void,
  ): Promise<void> {
    this.libraryKind = kind;
    this.libraryItems = [];
    this.libraryFilter = "";
    this.libraryLoading = true;
    this.libraryOpen = true;
    this.onPick = picker;
    this.touch();
    try {
      const r = await f(`/api/editor/library/${kind}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = await r.json();
      this.libraryItems = (data[kind] ?? []).map((row: LibraryRow) => ({
        ...row,
        id: String(row.id),
      }));
    } catch (e) {
      this.loadError = `library ${kind}: ${(e as Error).message}`;
    } finally {
      this.libraryLoading = false;
      this.touch();
    }
  }

  closeLibrary = (): void => {
    this.libraryOpen = false;
    this.onPick = null;
    this.touch();
  };

  setLibraryFilter = (v: string): void => {
    this.libraryFilter = v;
    this.touch();
  };

  pickFromLibrary = (rowId: EntityRef): void => {
    if (!this.onPick) return;
    // Bring the picked row into the local subtree if it isn't already there.
    if (this.libraryKind === "categories" && !this.categoryById(rowId)) {
      const row = this.libraryItems.find((r) => r.id === rowId) as
        | Category
        | undefined;
      if (row)
        this.categories.push({ ...row, songIds: row.songIds.map(String) });
    } else if (this.libraryKind === "songs" && !this.songById(rowId)) {
      const row = this.libraryItems.find((r) => r.id === rowId) as
        | Song
        | undefined;
      if (row)
        this.songs.push({
          ...row,
          trackIds: row.trackIds.map(String),
          effects: row.effects ?? {},
        });
    } else if (this.libraryKind === "tracks" && !this.trackById(rowId)) {
      const row = this.libraryItems.find((r) => r.id === rowId) as
        | Track
        | undefined;
      if (row) this.tracks.push({ ...row });
    }
    this.onPick(rowId);
    this.libraryOpen = false;
    this.onPick = null;
    this.mutate();
  };

  // Discriminate by libraryKind, not field-probing. The backend uses
  // json:"…,omitempty" on most string columns, so a Track with an empty
  // artist+title ships without those keys and an "'artist' in row" branch
  // would slip through to the Song path.
  get filteredLibrary(): LibraryRow[] {
    const f = foldForSearch(this.libraryFilter.trim());
    if (!f) return this.libraryItems;
    return this.libraryItems.filter((row) => {
      if (this.libraryKind === "categories") {
        return foldForSearch((row as Category).name ?? "").includes(f);
      }
      if (this.libraryKind === "tracks") {
        const r = row as Track;
        return foldForSearch((r.artist ?? "") + " " + (r.title ?? "")).includes(
          f,
        );
      }
      const s = row as Song;
      // Songs render in the modal as `{answer} - {firstArtist} - {firstTitle}`
      // (via songDisplay), so include the same fields in the haystack — the
      // operator's expectation is "I can type any of the visible words".
      return foldForSearch(
        [s.label, s.answer, s.firstArtist, s.firstTitle]
          .filter(Boolean)
          .join(" "),
      ).includes(f);
    });
  }

  // ─── Mutations: order entries ─────────────────────────────────────────
  addOrderCategoryFromLibrary = (): void => {
    void this.openLibrary("categories", (catId) => {
      this.order.push({
        id: this.makeTempID("order"),
        type: "cat",
        categoryId: catId,
      });
    });
  };
  addOrderCategoryNew = (): void => {
    const cat: Category = {
      id: this.makeTempID("cat"),
      name: "New category",
      mode: "",
      notice: "",
      illustration: "",
      trackType: "",
      liveOnly: false,
      songIds: [],
    };
    this.categories.push(cat);
    this.order.push({
      id: this.makeTempID("order"),
      type: "cat",
      categoryId: cat.id,
    });
    this.mutate();
  };
  addOrderPause = (): void => {
    this.order.push({ id: this.makeTempID("order"), type: "pause" });
    this.mutate();
  };
  removeOrderEntry = (idx: number): void => {
    this.order.splice(idx, 1);
    this.mutate();
  };
  moveOrderEntry = (idx: number, dir: -1 | 1): void => {
    const j = idx + dir;
    if (j < 0 || j >= this.order.length) return;
    const tmp = this.order[idx];
    this.order[idx] = this.order[j];
    this.order[j] = tmp;
    this.mutate();
  };

  // ─── Mutations: songs in a category ───────────────────────────────────
  addSongFromLibrary = (cat: Category): void => {
    void this.openLibrary("songs", (songId) => {
      if (!cat.songIds.includes(songId)) cat.songIds.push(songId);
    });
  };
  addSongNew = (cat: Category): void => {
    const sg: Song = {
      id: this.makeTempID("song"),
      label: "",
      status: "",
      answer: "",
      liveOnly: false,
      effects: {},
      trackIds: [],
    };
    this.songs.push(sg);
    cat.songIds.push(sg.id);
    this.mutate();
  };
  // createSongVariant spawns a fresh Song that shares the original's tracks
  // (RefList copied, not the Track rows themselves), then swaps it into the
  // current category's songIds in place of the source. The old song stays in
  // the library — other categories that referenced it keep doing so. Useful
  // for branching a song's metadata (different answer aliases, different
  // effects) without forking its audio.
  createSongVariant = (): void => {
    const src = this.selectedSong;
    const cat = this.selectedCategory;
    if (!src || !cat) return;
    const idx = cat.songIds.indexOf(src.id);
    if (idx < 0) return;
    const variant: Song = {
      id: this.makeTempID("song"),
      label: src.label,
      status: src.status,
      answer: src.answer,
      liveOnly: src.liveOnly,
      effects: { ...src.effects },
      trackIds: [...src.trackIds],
    };
    this.songs.push(variant);
    cat.songIds.splice(idx, 1, variant.id);
    this.selectedSongId = variant.id;
    this.selectedTrackId = null;
    this.mutate();
  };
  removeSongFromCategory = (cat: Category, songId: EntityRef): void => {
    const idx = cat.songIds.indexOf(songId);
    if (idx >= 0) cat.songIds.splice(idx, 1);
    if (this.selectedSongId === songId) {
      this.selectedSongId = null;
      this.selectedTrackId = null;
    }
    this.mutate();
  };

  // ─── Mutations: tracks in a song ──────────────────────────────────────
  addTrackFromLibrary = (sg: Song): void => {
    void this.openLibrary("tracks", (tid) => {
      if (!sg.trackIds.includes(tid)) sg.trackIds.push(tid);
    });
  };
  addTrackNew = (sg: Song): void => {
    const tk: Track = {
      id: this.makeTempID("track"),
      artist: "",
      title: "",
      type: "",
      start: 0,
      end: 0,
      youtubeId: "",
      audioRowId: 0,
      hasAudio: false,
    };
    this.tracks.push(tk);
    sg.trackIds.push(tk.id);
    this.mutate();
  };
  removeTrackFromSong = (sg: Song, tid: EntityRef): void => {
    const idx = sg.trackIds.indexOf(tid);
    if (idx >= 0) sg.trackIds.splice(idx, 1);
    if (this.selectedTrackId === tid) this.selectedTrackId = null;
    this.mutate();
  };

  // ─── Display helpers ──────────────────────────────────────────────────
  // Display label for a song row, both inside a category panel and in the
  // library picker: "{answer} - {artist} - {title}", with empty fields
  // dropped. Falls back to song.label, then to a placeholder. When the song
  // is in the loaded subtree we look up the first track locally; library
  // rows rely on backend-supplied firstArtist/firstTitle.
  songDisplay = (song: Song | undefined): string => {
    if (!song) return "<missing>";
    let artist = song.firstArtist ?? "";
    let title = song.firstTitle ?? "";
    if (!artist && !title && song.trackIds.length > 0) {
      const tk = this.trackById(song.trackIds[0]);
      if (tk) {
        artist = tk.artist;
        title = tk.title;
      }
    }
    const parts = [song.answer, artist, title]
      .map((p) => (p ?? "").trim())
      .filter((p) => p.length > 0);
    if (parts.length > 0) return parts.join(" - ");
    return song.label || "<song>";
  };

  // Flag a song that lacks a track matching its parent category's trackType
  // — the operator likely added it from the library and forgot to attach a
  // stems/karaoke/etc. variant. We bail conservatively when any of the
  // song's tracks isn't in the loaded subtree (library-picker songs ship
  // their trackIds but not the Tracks rows themselves), so we never raise
  // a false warning on incomplete info.
  songMissingExpectedTrackType = (sid: EntityRef, cat: Category): boolean => {
    const sg = this.songById(sid);
    if (!sg) return false;
    for (const tid of sg.trackIds) {
      const tk = this.trackById(tid);
      if (!tk) return false; // incomplete info — can't decide
      if (tk.type === cat.trackType) return false; // match found
    }
    // All trackIds resolved (or list is empty) and none matched: real warn.
    return true;
  };

  // Pretty label for an order entry (used in the order list).
  orderLabel = (o: OrderEntry): string => {
    if (o.type === "pause") return "— pause —";
    if (!o.categoryId) return "(no category)";
    const c = this.categoryById(o.categoryId);
    return c ? c.name || `category #${c.id}` : `<missing ${o.categoryId}>`;
  };

  // ─── Audio upload ─────────────────────────────────────────────────────
  async uploadAudioFile(
    track: Track,
    file: File,
    onUploaded: () => void,
  ): Promise<void> {
    this.uploadState = "uploading";
    this.uploadMessage = "";
    this.touch();
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await f("/api/editor/attachments", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!r.ok)
        throw new Error((await r.text()) || `${r.status} ${r.statusText}`);
      const data = (await r.json()) as { id: number };
      track.audioRowId = data.id;
      track.hasAudio = true;
      onUploaded();
      this.uploadState = "ok";
      this.uploadMessage = m["editor.attrs.audioUploadDone"]({ id: data.id });
      this.mutate();
    } catch (e) {
      this.uploadState = "error";
      this.uploadMessage = m["editor.attrs.audioUploadFailed"]({
        message: (e as Error).message,
      });
      this.touch();
    }
  }
}

/** Hook: re-render whenever the store's version bumps. */
export function useEditorStore(s: EditorStore): number {
  return useSyncExternalStore(s.subscribe, s.getVersion);
}
