// types.ts — the shape of the third-party notices the About page draws (../docs/about.md).
// A licence TEXT is stored once and named by key: thousands of MIT files differ only by a copyright line.

/** Where a component ships: the browser app, k7's server image, the engine binaries, the desktop app, the phone. */
export type Where = "web" | "server" | "engine" | "desktop" | "android";

export interface NoticeEntry {
  name: string;
  version: string | null;
  /** An SPDX expression, as the package or the hand list declares it. */
  license: string;
  url: string | null;
  where: Where[];
  /** A key into `Notices.texts`: the component's own notice, its copyright lines included. */
  text: string | null;
  /** Keys into `Notices.standards` the expression names, whose full text is stored once. */
  standards: string[];
  /** A short English remark from the hand list, such as which build carries it. */
  note?: string;
  /** Where the full licence text ships beside the component, when the page does not carry it. */
  shipped?: string;
}

export interface Notices {
  entries: NoticeEntry[];
  texts: Record<string, string>;
  standards: Record<string, string>;
}
