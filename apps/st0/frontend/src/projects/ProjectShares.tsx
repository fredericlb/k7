// ProjectShares.tsx — a project row's "Partages" button and the popin it opens: the frozen
// snapshots THIS project published, with the one place a share is withdrawn. The cost in bytes is
// said there too — a share never expires. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import type { ShareSummary } from "@studio/web-protocol";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { shares as api } from "./api";
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

export function ProjectShares({
  label,
  shares,
  onChanged,
}: {
  /** The project's name as the row shows it — that is what the title names. */
  label: string;
  /** THIS project's shares, revoked ones included (`sharesOf`). */
  shares: ShareSummary[];
  /** After a revoke, so the page re-reads without waiting for the poll. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = liveCount(shares);
  // What this weighs on the volume, in one number. Nothing here forbids anything: a share does not
  // expire, so the only thing that can prompt withdrawing one is seeing what they cost together.
  const total = shares
    .filter((s) => !s.revokedAt)
    .reduce((n, s) => n + s.bytes, 0);

  const copy = (s: ShareSummary) => {
    void navigator.clipboard.writeText(api.url(s.token)).then(
      () => {
        setCopied(s.key);
        setTimeout(() => setCopied(null), 1500);
      },
      // A refused clipboard (insecure page, permission) must not lose the link: it is written
      // beside it, on the row, and stays selectable by hand.
      () => setError("le presse-papiers a refusé — le lien est sur la ligne"),
    );
  };

  const revoke = (s: ShareSummary) => {
    // The sentence names what goes and what stays, because both surprise: the bytes vanish at
    // once, and a link already sent cannot be unsent.
    if (
      !window.confirm(
        `Retirer « ${s.name || label} » ?\n\n` +
          `Le son et le graphe sont effacés du serveur : le lien répondra « introuvable » à ` +
          `tous ceux qui l'ont, tout de suite et définitivement. La ligne reste ici, datée.\n\n` +
          `Republier le projet donnera un NOUVEAU lien — celui-ci ne revient pas.`,
      )
    )
      return;
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
      {/* Discret comme « Supprimer » à côté : le geste courant sur cette ligne est d'OUVRIR le
          projet, et ce bouton-ci n'a pas à le concurrencer du regard. Le compte est dessus quand
          il y en a, ce qui fait du bouton lui-même l'indicateur : sans lui il faudrait ouvrir
          chaque popin pour savoir laquelle est vide. */}
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
              <span className="truncate">Partages de « {label} »</span>
              {live > 0 && (
                <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                  {live} lien{live > 1 ? "s" : ""} · {bytes(total)}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              Des copies <b>gelées</b> de ce projet, publiées depuis st0 par{" "}
              <code>project share link</code>. Elles s'écoutent et se regardent
              sans compte et sans moteur, et ne s'éditent pas. Un partage{" "}
              <b>n'expire pas</b> : il vit sur le serveur jusqu'à ce que vous le
              retiriez.
            </DialogDescription>
          </DialogHeader>

          {shares.length === 0 ? (
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
                      {/* L'adresse est un LIEN, pas un bouton : c'est ce qu'on a envoyé aux
                          autres, et la seule façon de vérifier ce qu'ils voient est de
                          l'ouvrir. `noopener` parce que la page d'en face est publique. */}
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
                        onClick={() => revoke(s)}
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
          )}

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
