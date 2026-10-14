// routing.ts — where a navigation inside the window lands: the home tab, a project's tab, in place, or the system browser.
// Pure, so it is tested without Electron. The rules are docs/tabs.md's table.

import {
  EXTERNAL_SEGMENT,
  isProjectAddress,
  parseLaunch,
} from "@studio/web-protocol/projects";

/** Where a URL goes: `key` names the project, so one project never holds two tabs. */
export type Destination =
  | { to: "browser" }
  | { to: "inPlace" }
  | { to: "signIn" }
  | { to: "home" }
  | { to: "project"; key: string }
  | { to: "window" };

/** Served by the backend itself rather than the SPA: a sign-in round trip has to finish in the tab that started it. */
const SERVER_PATHS = ["auth", "api", "rtc"];

const segments = (p: string): string[] => p.split("/").filter(Boolean);

/** The project a path names, as a key two spellings of the same project agree on — or null. */
export function projectKey(pathname: string): string | null {
  const l = parseLaunch(pathname, "k7", "");
  if (!l) return null;
  // A folder-less address (`@local/<ws>`, `@shares/<token>`) is told apart by its second segment.
  if (l.project === ".") return `${l.repo}/${segments(pathname)[1] ?? ""}`;
  return `${l.repo}/${l.project}`;
}

/** Where `url` lands, from a page on `origin`. */
export function destination(url: string, origin: string): Destination {
  let to: URL;
  try {
    to = new URL(url);
  } catch {
    return { to: "inPlace" };
  }
  if (to.origin !== origin) return { to: "browser" };
  const segs = segments(to.pathname);
  // The identity provider's pages belong in the system browser, so the sign-in starts there.
  if (segs[0] === "auth" && segs[1] === "login") return { to: "signIn" };
  if (SERVER_PATHS.includes(segs[0] ?? "")) return { to: "inPlace" };
  // A surface on its own is a WINDOW beside the project, never a second tab of it.
  if (segs.includes(EXTERNAL_SEGMENT)) return { to: "window" };
  if (!isProjectAddress(url)) return { to: "home" };
  const key = projectKey(to.pathname);
  return key ? { to: "project", key } : { to: "home" };
}
