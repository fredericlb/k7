// liveConfirmed.ts — a replica's confirmed text on disk: the room's files as it last applied them.
// A mirror folder beside the workspace's sync log, never inside the workspace. A restart diffs the
// workspace against it, which is how an edit made while the service was down is still sent. See docs/liveCapture.md.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { ConfirmedStore } from "@studio/live-sync/replica";
import { isAtomicTemp, writeFileAtomic } from "@studio/song/atomicWrite";
import { confinedPath } from "./livePath.ts";

export class ConfirmedDir implements ConfirmedStore {
  constructor(private readonly root: string) {}

  private abs(file: string): string {
    return confinedPath(this.root, file);
  }

  get(file: string): string | null {
    const abs = this.abs(file);
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  }

  set(file: string, text: string | null): void {
    const abs = this.abs(file);
    if (text === null) rmSync(abs, { force: true });
    else {
      mkdirSync(dirname(abs), { recursive: true });
      // Not durable: a mirror torn by a crash only makes the next start resend text the room already holds.
      writeFileAtomic(abs, text, { durable: false });
    }
  }

  files(): string[] {
    if (!existsSync(this.root)) return [];
    const out: string[] = [];
    const visit = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const child = join(dir, e.name);
        if (e.isDirectory()) visit(child);
        else if (!isAtomicTemp(e.name))
          out.push(relative(this.root, child).split(sep).join("/"));
      }
    };
    visit(this.root);
    return out;
  }
}
