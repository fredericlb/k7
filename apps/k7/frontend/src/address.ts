// address.ts — what an address IS to this page, read out of the path and nothing else: a share,
// a rehearsal public page, the surfaces menu, the home pages, or a project. Each is a SCOPE, and
// the scope's key is what the router is mounted by — so going between two of them remounts it,
// while moving inside one does not. Pure, so it is tested without a page. See ../docs/shell.md.

import {
  isExternalIndex,
  type Launch,
  parseExternal,
  parseLaunch,
  projectBasename,
} from "@studio/project-shell/launch";
import { publicPageAt } from "@studio/ui-rehearsal/addresses";
import {
  isHomePage,
  isShare,
  REHEARSAL_PAGE,
  shareToken,
} from "@studio/web-protocol/projects";

export type Scope =
  | { kind: "share"; key: string; basename: string; token: string }
  | { kind: "rehearsal-public"; key: string; basename: string; nametag: string }
  | { kind: "external-index"; key: string; basename: string }
  | { kind: "home"; key: string; basename: string }
  | {
      kind: "project";
      key: string;
      basename: string;
      at: Launch;
      /** The one surface this tab draws, when the address names one. */
      external: string | null;
    };

/** The scope `pathname` belongs to, under the app's mount `base` — the same reading appMain made once per page. */
export function scopeOf(pathname: string, base: string): Scope {
  const root = base.replace(/\/$/, "");
  // The surfaces menu first: a single segment is a legal project address, so the word is reserved.
  if (isExternalIndex(pathname, base))
    return { kind: "external-index", key: "external", basename: base };
  if (isHomePage(pathname, base)) {
    const nametag = publicPageAt(pathname, `${root}/${REHEARSAL_PAGE}`);
    return nametag
      ? {
          kind: "rehearsal-public",
          key: `rehearsal:${nametag}`,
          basename: base,
          nametag,
        }
      : { kind: "home", key: "home", basename: base };
  }
  const at = parseLaunch(pathname, "k7", base);
  if (!at) return { kind: "home", key: "home", basename: base };
  const basename = projectBasename(pathname, "k7", base);
  const token = isShare(at.repo) ? shareToken(at.project) : null;
  if (token) return { kind: "share", key: `share:${token}`, basename, token };
  return {
    kind: "project",
    key: `project:${basename}`,
    basename,
    at,
    external: parseExternal(pathname, "k7", base),
  };
}

// The server's own paths and the files it serves: a link to one is a page load, never a scope.
const SERVER_PREFIXES = ["api", "auth", "assets", "@fs", "@vite", "src"];
const STATIC_FILE =
  /\.(m?js|css|map|svg|png|jpe?g|webp|gif|ico|json|webmanifest|txt|xml|woff2?|wasm|wav|mp3|flac|ogg|mp4|webm|zip|pdf)$/i;

/** Whether this page can draw `url` without loading: same origin, under the mount, and not a server path or a file. */
export function isAppAddress(url: URL, origin: string, base: string): boolean {
  if (url.origin !== origin) return false;
  const root = base.replace(/\/$/, "");
  if (root && url.pathname !== root && !url.pathname.startsWith(`${root}/`))
    return false;
  const rest = url.pathname.slice(root.length).split("/").filter(Boolean);
  if (rest.length && SERVER_PREFIXES.includes(rest[0])) return false;
  return !STATIC_FILE.test(rest[rest.length - 1] ?? "");
}
