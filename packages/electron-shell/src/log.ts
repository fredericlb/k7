// log.ts — one merged log for the app and every child, prefixed by who said it.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

let file: string | null = null;

/** Truncate and adopt `path`; one launch is one log. */
export function openLog(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  file = path;
}

export function line(who: string, text: string): void {
  const out = `${new Date().toISOString()} ${who.padEnd(10)} ${text}`;
  console.log(out);
  if (file) appendFileSync(file, `${out}\n`);
}

/** A line-splitting sink for a child's stdout or stderr. */
export function relay(who: string): (chunk: Buffer) => void {
  return (chunk) => {
    for (const l of chunk.toString("utf8").split(/\r?\n/))
      if (l.trim()) line(who, l);
  };
}
