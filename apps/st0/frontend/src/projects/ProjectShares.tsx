// ProjectShares.tsx — a project row's "Partages" button and the popin it opens, under two tabs:
// the frozen snapshots THIS project published, with the one place a share is withdrawn (the cost
// in bytes is said there too, a share never expiring), and the QR codes that open the same
// project LIVE on a second device. Two ways out of one project, and docs/external.md is why they
// are two tabs rather than one list. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { askConfirm } from "@studio/project-shell/ask";
import type { ShareSummary } from "@studio/web-protocol";
import { Check, Copy, Loader2, QrCode, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { shares as api } from "./api";
import type { Machine } from "./machine";
import { ProjectSurfaces } from "./ProjectSurfaces";
import { liveCount } from "./sharesForProject";

function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ko`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

/** The day, without the hour: what tells two snapshots of the same song apart. */
const day = (iso: string): string =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Not the settings screen's strip: that one is painted in `neutral-*`, and this page's palette is the theme's. */
function Strip({
  current,
  onPick,
}: {
  current: Tab;
  onPick: (t: Tab) => void;
}) {
  return (
    <nav className="flex gap-1 border-b border-border">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={id === current ? "page" : undefined}
          onClick={() => onPick(id)}
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
            id === current
              ? "border-foreground text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </nav>
  );
}

const TABS = [
  { id: "shares", label: "Partages", icon: Share2 },
  { id: "surfaces", label: "Surfaces", icon: QrCode },
] as const;

type Tab = (typeof TABS)[number]["id"];

export function ProjectShares({
  label,
  shares,
  onChanged,
  projectUrl,
  workspace,
  path,
  machine,
  lanUrls,
}: {
  /** The project's name as the row shows it — that is what the title names. */
  label: string;
  /** THIS project's shares, revoked ones included (`sharesOf`). */
  shares: ShareSummary[];
  /** After a revoke, so the page re-reads without waiting for the poll. */
  onChanged: () => void;
  /** Where this project opens on THIS origin — the Surfaces tab rebases it per device. */
  projectUrl: string;
  workspace: string;
  /** Workspace-relative, as `/workspaces/surfaces` spells it. */
  path: string;
  /** The chosen machine, which is what knows a project's surfaces — null when none answers. */
  machine: Machine | null;
  /** Where a second device reaches this app (apps/studio-desktop/docs/externals.md). */
  lanUrls: string[];
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("shares");
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = liveCount(shares);
  // What this weighs on the volume, in one number: a share does not expire, so seeing what they cost together is the only prompt.
  const total = shares
    .filter((s) => !s.revokedAt)
    .reduce((n, s) => n + s.bytes, 0);

  const copy = (s: ShareSummary) => {
    void navigator.clipboard.writeText(api.url(s.token)).then(
      () => {
        setCopied(s.key);
        setTimeout(() => setCopied(null), 1500);
      },
      // A refused clipboard must not lose the link: it is written beside it, on the row, and stays selectable by hand.
      () => setError("le presse-papiers a refusé — le lien est sur la ligne"),
    );
  };

  const revoke = async (s: ShareSummary) => {
    // The sentence names what goes and what stays, because both surprise: the bytes vanish at once, and a link sent cannot be unsent.
    const agreed = await askConfirm({
      title: `Retirer « ${s.name || label} » ?`,
      body:
        `Le son et le graphe sont effacés du serveur : le lien répondra « introuvable » à ` +
        `tous ceux qui l'ont, tout de suite et définitivement. La ligne reste ici, datée.\n\n` +
        `Republier le projet donnera un NOUVEAU lien — celui-ci ne revient pas.`,
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!agreed) return;
    setBusy(s.key);
    setError(null);
    void api
      .revoke(s.key)
      .then(onChanged)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  };

  return (
    <>
      {/* Discreet, like Supprimer beside it, and carrying the count so the button itself says which project has shares. */}
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        title={
          live > 0
            ? `${live} lien${live > 1 ? "s" : ""} publié${live > 1 ? "s" : ""} · ${bytes(total)}`
            : `Aucun partage publié pour ${label}`
        }
        onClick={(e) => {
          // The whole row is a link to the project: without this, the button would open it.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Partages{live > 0 ? ` (${live})` : ""}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-baseline gap-2">
              <span className="truncate">« {label} »</span>
              {tab === "shares" && live > 0 && (
                <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                  {live} lien{live > 1 ? "s" : ""} · {bytes(total)}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {tab === "shares" ? (
                <>
                  Des copies <b>gelées</b> de ce projet, publiées depuis st0 par{" "}
                  <code>project share link</code>. Elles s'écoutent et se
                  regardent sans compte et sans moteur, et ne s'éditent pas. Un
                  partage <b>n'expire pas</b> : il vit sur le serveur jusqu'à ce
                  que vous le retiriez.
                </>
              ) : (
                <>
                  À <b>scanner</b> depuis une tablette ou un téléphone du même
                  réseau. Ces adresses sont <b>vivantes</b> : elles pilotent le
                  moteur qui tient ce projet, là où un partage est une copie
                  gelée. Le premier code ouvre le projet entier, donc son
                  éditeur ; les suivants une seule surface.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <Strip current={tab} onPick={setTab} />

          {tab === "surfaces" && (
            <ProjectSurfaces
              label={label}
              projectUrl={projectUrl}
              workspace={workspace}
              path={path}
              machine={machine}
              lanUrls={lanUrls}
            />
          )}

          {tab === "shares" &&
            (shares.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucun partage. Le lien se crée dans st0, sur le projet ouvert.
              </p>
            ) : (
              <ul className="flex max-h-[50vh] flex-col divide-y divide-border/60 overflow-y-auto">
                {shares.map((s) => {
                  const url = s.token ? api.url(s.token) : "";
                  return (
                    <li key={s.key} className="flex items-center gap-2 py-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-baseline gap-2 text-sm">
                          <span className="truncate">{s.name || label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            {day(s.createdAt)}
                          </span>
                          {s.revokedAt && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              retiré le {day(s.revokedAt)}
                            </span>
                          )}
                        </div>
                        {/* The address is a LINK: opening it is the only way to check what the people you sent it to see; `noopener` because that page is public. */}
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
                          >
                            {url}
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            le lien a été effacé avec les fichiers
                          </span>
                        )}
                      </div>

                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {s.revokedAt ? "—" : bytes(s.bytes)}
                      </span>

                      {url && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => copy(s)}
                        >
                          {copied === s.key ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {!s.revokedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => void revoke(s)}
                          disabled={busy === s.key}
                        >
                          {busy === s.key ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}

          {error && (
            <code className="rounded bg-muted px-2 py-1 text-xs text-red-400">
              {error}
            </code>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
