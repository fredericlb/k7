// ProjectRow.tsx — one project under its workspace on the home page: a LINK first (the archetype's
// glyph, the name, whether it is the open one, when it last changed), then its shares and its ⋮.
// There is no app badge: every project here is opened by k7. See ../../docs/projects.md.

import { Badge } from "@frediverse/ui/badge";
import { CornerDownRight } from "@frediverse/ui/icons";
import type {
  AccountWorkspace,
  RepoProject,
  ShareSummary,
} from "@studio/web-protocol";
import { projectLabel } from "@studio/web-protocol/projects";
import { m } from "../paraglide/messages.js";
import { ProjectMenu } from "./ProjectMenu";
import { ProjectShares } from "./ProjectShares";
import { editedAgo, shapeOfSurfaces } from "./projectKind";
import { shapeWords } from "./shapes";
import { sharesOf } from "./sharesForProject";

/** The folder's name without its suffix, or the workspace's when the workspace IS the project. */
const labelOf = (w: AccountWorkspace, p: RepoProject): string =>
  p.path === "."
    ? projectLabel(w.name)
    : projectLabel(p.path.split("/").pop() ?? p.path);

/** The folder holding the project, or null when it sits at the workspace root. */
const parentOf = (p: RepoProject): string | null => {
  const cut = p.path.lastIndexOf("/");
  return cut > 0 ? p.path.slice(0, cut) : null;
};

export function ProjectRow({
  workspace: w,
  project: p,
  href,
  targets,
  blocked,
  shares,
  onChanged,
  now,
  locale,
  onCopy,
  onRename,
  onDelete,
}: {
  workspace: AccountWorkspace;
  project: RepoProject;
  href: string;
  /** Where a copy may land. */
  targets: AccountWorkspace[];
  blocked: string;
  shares: ShareSummary[];
  onChanged: () => void;
  /** The clock "edited … ago" is read against, ticked by the list so every row ages together. */
  now: number;
  locale: string;
  onCopy: (
    to: AccountWorkspace,
    folder: string,
    onStep: (s: string) => void,
  ) => Promise<void>;
  onRename: (folder: string, onStep: (s: string) => void) => Promise<void>;
  onDelete: (onStep: (s: string) => void) => Promise<void>;
}) {
  const label = p.path === "." ? w.name : labelOf(w, p);
  const shape = shapeOfSurfaces(p.surfaces);
  const kind = shape ? shapeWords(shape) : null;
  const Glyph = kind?.icon ?? CornerDownRight;
  const parent = parentOf(p);
  return (
    // The row holds the link AND the buttons: the link stretches, and each button's `preventDefault` stops it opening.
    <li className="flex items-center gap-1">
      <a
        className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60"
        title={m["repos.openProject"]({ path: p.path })}
        href={href}
      >
        <Glyph
          className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground"
          aria-label={kind?.label()}
        />
        <span className="truncate">{labelOf(w, p)}</span>
        {p.active && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            title={m["repos.active"]()}
            role="img"
            aria-label={m["repos.active"]()}
          />
        )}
        {/* A demo is overwritten by the next update or reset: said before anyone edits one and loses it. */}
        {p.demo && (
          <Badge
            variant="amber"
            className="shrink-0"
            title={m["demo.badgeHint"]()}
          >
            {m["demo.badge"]()}
          </Badge>
        )}
        {p.tags?.map((t) => (
          <Badge key={t} className="shrink-0">
            {t}
          </Badge>
        ))}
        {parent && (
          <span className="hidden truncate text-muted-foreground text-xs sm:inline">
            {parent}
          </span>
        )}
        {p.editedAt !== undefined && (
          <span className="ml-auto hidden shrink-0 pl-3 text-muted-foreground text-xs tabular-nums sm:inline">
            {m["repos.edited"]({ when: editedAgo(p.editedAt, now, locale) })}
          </span>
        )}
      </a>
      {/* Before the ⋮: reading what you published comes ahead of the destructive act, and needs the file service (../../docs/projects.md). */}
      <ProjectShares
        label={label}
        shares={sharesOf(shares, w.name, p.path)}
        onChanged={onChanged}
      />
      {/* …and the three ACTS behind one ⋮: the row is a link first, and these are rare. */}
      <ProjectMenu
        path={p.path}
        label={label}
        app={p.app}
        blocked={blocked}
        targets={targets}
        onCopy={onCopy}
        onRename={onRename}
        onDelete={onDelete}
      />
    </li>
  );
}
