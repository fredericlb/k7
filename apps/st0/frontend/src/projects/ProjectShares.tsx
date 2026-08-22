// ProjectShares.tsx — le bouton « Partages » d'une rangée de projet, et la popin qu'il ouvre :
// les instantanés gelés que CE projet a publiés, avec le seul endroit où l'on en retire un. Le
// coût en octets est dit là aussi — un partage n'expire jamais. Voir ../../docs/projects.md.

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

/** Le jour, sans l'heure : ce qui distingue deux instantanés du même morceau. */
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
  /** Le nom du projet, tel que la rangée l'affiche — c'est lui que le titre nomme. */
  label: string;
  /** Les partages de CE projet, révoqués compris (`sharesOf`). */
  shares: ShareSummary[];
  /** Après une révocation, pour que la page relise sans attendre le poll. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = liveCount(shares);
  // Ce que ça pèse sur le volume, en un nombre. Rien ici n'interdit quoi que ce soit : un
  // partage n'expire pas, donc la seule chose qui peut décider d'en retirer un est de voir ce
  // qu'ils coûtent ensemble.
  const total = shares
    .filter((s) => !s.revokedAt)
    .reduce((n, s) => n + s.bytes, 0);

  const copy = (s: ShareSummary) => {
    void navigator.clipboard.writeText(api.url(s.token)).then(
      () => {
        setCopied(s.key);
        setTimeout(() => setCopied(null), 1500);
      },
      // Un presse-papiers refusé (page non sécurisée, permission) ne doit pas perdre le lien :
      // il est écrit à côté, sur la ligne, et reste sélectionnable à la main.
      () => setError("le presse-papiers a refusé — le lien est sur la ligne"),
    );
  };

  const revoke = (s: ShareSummary) => {
    // La phrase nomme ce qui part et ce qui reste, parce que les deux surprennent : les octets
    // disparaissent tout de suite, et le lien déjà envoyé ne se dé-envoie pas.
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
          // La rangée entière est un lien vers le projet : sans ça, le bouton l'ouvrirait.
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
