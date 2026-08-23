// store.ts — the open session: every file's Document, the read models over them, and the
// debounced write-back. One store rather than component state because a Document must outlive
// a re-render — re-parsing on each keystroke would drop the comments an edit is meant to keep.
// See docs/editing.md.

import type { FileNode } from "@studio/web-protocol";
import type { Document } from "yaml";
import { api } from "./api";
import {
  type Category,
  newCategoryText,
  parseDocument,
  readCategory,
  readSession,
  type Session,
  serialize,
  slugOf,
} from "./format";
import { type Catalogue, loadCatalogue } from "./mediatek";

const SAVE_DELAY_MS = 800;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Every `.yaml` under `categories/`, in the order the tree walked them. */
function categoryFiles(nodes: FileNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: FileNode[]): void => {
    for (const n of ns) {
      if (n.dir) walk(n.children ?? []);
      else if (/^categories\/.+\.ya?ml$/.test(n.path)) out.push(n.path);
    }
  };
  walk(nodes);
  return out.sort();
}

export class Store {
  session: Session | null = null;
  sessionDoc: Document | null = null;
  categories = new Map<string, Category>();
  catalogue: Catalogue = new Map();
  loadError = "";
  /** Set when the catalogue alone failed: the session still edits, the labels just read as ids. */
  catalogueError = "";
  saveStatus: SaveStatus = "idle";
  saveError = "";

  private docs = new Map<string, Document>();
  private slugToPath = new Map<string, string>();
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** A change that only affects what is on screen — no write. */
  touch = (): void => this.emit();

  async load(): Promise<void> {
    try {
      const tree = await api.tree();
      const sessionFile = "session.yaml";
      const files = categoryFiles(tree);

      const session = await api.read(sessionFile).catch(() => null);
      if (session) {
        this.sessionDoc = parseDocument(session.content);
        this.docs.set(sessionFile, this.sessionDoc);
        this.session = readSession(this.sessionDoc);
      }

      for (const path of files) {
        const f = await api.read(path);
        const doc = parseDocument(f.content);
        const slug = slugOf(path);
        this.docs.set(path, doc);
        this.slugToPath.set(slug, path);
        this.categories.set(slug, readCategory(slug, doc));
      }
    } catch (e) {
      this.loadError = (e as Error).message;
    }
    this.emit();
    // After the files and never blocking them — see ../../docs/editing.md.
    try {
      this.catalogue = await loadCatalogue();
    } catch (e) {
      this.catalogueError = (e as Error).message;
    }
    this.emit();
  }

  categoryDoc(slug: string): Document | null {
    const path = this.slugToPath.get(slug);
    return path ? (this.docs.get(path) ?? null) : null;
  }

  /** Edit one category's file, re-read it, and schedule the save. */
  editCategory(slug: string, fn: (doc: Document) => void): void {
    const path = this.slugToPath.get(slug);
    const doc = path && this.docs.get(path);
    if (!path || !doc) return;
    fn(doc);
    this.categories.set(slug, readCategory(slug, doc));
    this.dirty.add(path);
    this.emit();
    this.schedule();
  }

  /** Edit session.yaml, re-read it, and schedule the save. */
  editSession(fn: (doc: Document) => void): void {
    if (!this.sessionDoc) return;
    fn(this.sessionDoc);
    this.session = readSession(this.sessionDoc);
    this.dirty.add("session.yaml");
    this.emit();
    this.schedule();
  }

  /** A slug that is a legal file name and not already taken. */
  freeSlug(name: string): string {
    const base =
      name
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "categorie";
    if (!this.slugToPath.has(base)) return base;
    for (let n = 2; ; n++)
      if (!this.slugToPath.has(`${base}-${n}`)) return `${base}-${n}`;
  }

  /** A category is a FILE, written through at once: everything after addresses it by path. */
  async createCategory(name: string): Promise<string> {
    const slug = this.freeSlug(name);
    const path = `categories/${slug}.yaml`;
    const doc = parseDocument(newCategoryText(name));
    this.docs.set(path, doc);
    this.slugToPath.set(slug, path);
    this.categories.set(slug, readCategory(slug, doc));
    this.emit();
    try {
      await api.write(path, serialize(doc));
    } catch (e) {
      this.saveStatus = "error";
      this.saveError = (e as Error).message;
      this.emit();
    }
    return slug;
  }

  /** The rounds that named it are LEFT alone: editing another file invisibly is the worse fault. */
  async deleteCategory(slug: string): Promise<void> {
    const path = this.slugToPath.get(slug);
    if (!path) return;
    this.docs.delete(path);
    this.slugToPath.delete(slug);
    this.categories.delete(slug);
    this.dirty.delete(path);
    this.emit();
    try {
      await api.deleteFile(path);
    } catch (e) {
      this.saveStatus = "error";
      this.saveError = (e as Error).message;
      this.emit();
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Write every dirty file. Called on a timer, and directly by Ctrl+S. */
  flush = async (): Promise<void> => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty.size === 0) return;
    const paths = [...this.dirty];
    this.dirty.clear();
    this.saveStatus = "saving";
    this.emit();
    try {
      for (const path of paths) {
        const doc = this.docs.get(path);
        if (doc) await api.write(path, serialize(doc));
      }
      this.saveStatus = "saved";
      this.saveError = "";
    } catch (e) {
      // Put them back: an unsaved edit that has been forgotten is worse than a visible error.
      for (const p of paths) this.dirty.add(p);
      this.saveStatus = "error";
      this.saveError = (e as Error).message;
    }
    this.emit();
  };

  get hasUnsaved(): boolean {
    return this.dirty.size > 0;
  }
}
