// publicLibraries.ts — the origin's PUBLISHED versions of the libraries every install starts from,
// readable without signing in, so a desktop never paired can still upgrade. Only PUBLIC_LIBRARIES:
// any other library reaches a machine through a paired account. Never the draft. A published version
// never changes, so its listing is computed once per process. See ../../docs/library-versions-plan.md.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { DEFAULT_LIBRARY } from "@studio/song-schema/moduleTypes";
import type { Request, Response } from "express";
import type { LibraryStore } from "./libraries.ts";

/** The libraries anyone may read: the one a new install is seeded with. */
export const PUBLIC_LIBRARIES: readonly string[] = [DEFAULT_LIBRARY];

/** One file of a published version, as a machine fetching it checks it. */
export interface VersionFile {
  path: string;
  size: number;
  sha256: string;
}

/** Every file of the folder at `root`, `/`-separated, skipping dot-names. */
export function versionFiles(root: string): VersionFile[] {
  const out: VersionFile[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      if (name.startsWith(".")) continue;
      const abs = join(at, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else
        out.push({
          path: relative(root, abs).split(sep).join("/"),
          size: st.size,
          sha256: createHash("sha256").update(readFileSync(abs)).digest("hex"),
        });
    }
  };
  walk(root);
  return out;
}

export class PublicLibraries {
  private readonly listings = new Map<string, VersionFile[]>();

  constructor(private readonly store: LibraryStore) {}

  /** `GET /`, `GET /<name>/<v>` and `GET /<name>/<v>/file?path=…`, under the public prefix. */
  readonly handler = (req: Request, res: Response): void => {
    try {
      this.route(req, res);
    } catch (e) {
      if (!res.headersSent)
        res.status(500).json({ error: (e as Error).message });
    }
  };

  private route(req: Request, res: Response): void {
    if (req.method !== "GET") {
      res.status(405).json({ error: "read-only" });
      return;
    }
    const segs = req.path.split("/").filter(Boolean);
    if (!segs.length) {
      res.json({
        libraries: PUBLIC_LIBRARIES.map((name) => ({
          name,
          versions: this.store.versions(name),
        })),
      });
      return;
    }
    const [name, v, what] = segs;
    const version = Number(v);
    const known =
      PUBLIC_LIBRARIES.includes(name) &&
      this.store.versions(name).some((m) => m.version === version);
    if (!known || (what && what !== "file") || segs.length > 3) {
      res.status(404).json({ error: `no published version ${name} ${v}` });
      return;
    }
    const root = join(this.store.home, name, String(version));
    if (!what) {
      const key = `${name}/${version}`;
      let files = this.listings.get(key);
      if (!files) {
        files = versionFiles(root);
        this.listings.set(key, files);
      }
      res.json({ name, version, files });
      return;
    }
    const path = typeof req.query.path === "string" ? req.query.path : "";
    let real: string | null = null;
    try {
      real = path ? realpathSync(resolve(root, path)) : null;
    } catch {
      real = null; // not there: the same answer as outside
    }
    // Confined by REAL path: neither a `..` nor a link inside a version may serve a file outside it.
    if (!real?.startsWith(realpathSync(root) + sep)) {
      res.status(404).json({ error: `no file ${path}` });
      return;
    }
    res.sendFile(real);
  }
}
