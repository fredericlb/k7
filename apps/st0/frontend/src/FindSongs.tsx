// FindSongs.tsx — « Trouver des morceaux » : un champ de recherche, et sous lui l'historique
// de ce qu'on a déjà demandé, vert quand c'est rangé, bleu pendant, rouge quand ça a échoué.
// La recherche tourne côté serveur pendant des minutes ; cet écran ne fait que la regarder.
// Voir ../../docs/hunt.md.

import { Button } from "@frediverse/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@frediverse/ui/dialog";
import { Input } from "@frediverse/ui/input";
import type { HuntRecord, HuntStatus } from "@studio/web-protocol/hunt";
// Clapperboard et non un logo : lucide a retiré ses icônes de marque, et « une vidéo » est de
// toute façon ce que la source est réellement.
import {
  CheckCircle2,
  Clapperboard,
  Loader2,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { hunt } from "./api";

/** Assez rapide pour qu'un changement de pair se voie, assez lent pour qu'un écran ouvert une
 *  demi-heure ne martèle pas le backend. Une recherche dure des minutes, pas des secondes. */
const POLL_MS = 2000;

/** Les trois couleurs demandées, et le fait qu'il n'y en ait que trois pour quatre états :
 *  « on cherche » et « ça télécharge » sont tous deux « en cours » pour qui regarde. */
const TONE: Record<HuntStatus, string> = {
  done: "border-l-emerald-500",
  searching: "border-l-sky-500",
  downloading: "border-l-sky-500",
  failed: "border-l-destructive",
};

function Icon({ status }: { status: HuntStatus }) {
  if (status === "done")
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (status === "failed")
    return <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />;
  return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-500" />;
}

/** Ce que la ligne raconte d'elle-même, en une phrase. Le détail utile diffère selon l'état :
 *  au téléchargement c'est QUI envoie, à l'échec c'est pourquoi, une fois rangé c'est où. */
function detail(h: HuntRecord): string {
  if (h.status === "failed") return h.error ?? "échec";
  if (h.status === "searching") return "recherche du morceau…";
  if (h.status === "downloading") {
    // Le secours ne passe par aucun pair : dire « en attente d'un pair » pendant que yt-dlp
    // travaille décrirait la mauvaise machine.
    if (h.via === "youtube") return "téléchargement depuis YouTube…";
    const who = h.peer ? `chez ${h.peer}` : "en attente d'un pair";
    const tries = h.switches ? ` — ${h.switches + 1}ᵉ pair essayé` : "";
    return `${who}${tries}`;
  }
  const from = h.via === "youtube" ? "YouTube · " : "";
  return `${from}${h.error ?? h.path ?? "rangé"}`;
}

/** Le format obtenu, dit sans détour : un 128 kbps qui s'annonce ne sera pas pris pour une
 *  référence de mix six mois plus tard. */
function quality(h: HuntRecord): string | null {
  if (!h.format) return null;
  const ext = h.format.replace(/^\./, "").toUpperCase();
  return h.bitrate ? `${ext} ${h.bitrate} kbps` : ext;
}

function Row({
  h,
  youtube,
  onForget,
  onYoutube,
}: {
  h: HuntRecord;
  /** yt-dlp est-il là ? Sinon le secours est proposé en grisé, en disant pourquoi — un bouton
   *  qui échouerait au clic n'apprendrait rien de plus. */
  youtube: boolean;
  onForget: (id: string) => void;
  onYoutube: (id: string) => void;
}) {
  const named = h.artist && h.title ? `${h.artist} — ${h.title}` : h.query;
  const q = quality(h);
  return (
    <li
      className={`flex items-start gap-3 border-l-2 ${TONE[h.status]} bg-secondary/30 px-3 py-2`}
    >
      <span className="mt-0.5">
        <Icon status={h.status} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-medium">{named}</span>
          {h.album && (
            <span className="truncate text-xs text-muted-foreground">
              {h.album}
              {h.date ? ` · ${h.date.slice(0, 4)}` : ""}
            </span>
          )}
          {q && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {q}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {detail(h)}
        </span>
      </span>
      {/* Le secours, et seulement sur les lignes rouges : c'est un autre marché — un flux
          compressé tiré d'une vidéo plutôt que le fichier de quelqu'un — et savoir quel
          morceau le mérite est un jugement sur le morceau. D'où un bouton, jamais un repli
          automatique. Voir ../../docs/hunt.md. */}
      {h.status === "failed" && (
        <Button
          variant="secondary"
          size="xs"
          className="shrink-0"
          disabled={!youtube}
          title={
            youtube
              ? "Récupérer ce morceau sur YouTube (audio compressé)"
              : "yt-dlp n'est pas installé sur ce serveur"
          }
          onClick={() => onYoutube(h.id)}
        >
          <Clapperboard className="mr-1 h-3.5 w-3.5" /> DL sur YouTube
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        title={
          h.status === "searching" || h.status === "downloading"
            ? "Abandonner cette recherche"
            : "Retirer de l'historique"
        }
        onClick={() => onForget(h.id)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

export function FindSongs({ onFiled }: { onFiled: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<HuntRecord[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [youtube, setYoutube] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // QUELLES lignes étaient déjà rangées, et non combien : une ligne retirée de l'historique
  // ferait baisser un compteur, et le morceau suivant le ramènerait au même chiffre sans que
  // le catalogue derrière le dialogue soit rafraîchi.
  const filed = useRef<Set<string> | null>(null);

  // Ne tourne QUE dialogue ouvert : une recherche vit sur le serveur, et un onglet qui
  // interrogerait en permanence pour un écran fermé paierait un aller-retour pour rien.
  useEffect(() => {
    if (!open) return;
    let stop = false;
    const tick = () =>
      void hunt
        .list()
        .then((l) => {
          if (stop) return;
          setRows(l.hunts);
          setReason(l.configured ? null : l.reason);
          setYoutube(l.youtube);
          const done = new Set(
            l.hunts.filter((h) => h.status === "done").map((h) => h.id),
          );
          // Le premier tour ne rafraîchit rien : tout y est nouveau, et le catalogue vient
          // d'être chargé de toute façon.
          if (filed.current && [...done].some((id) => !filed.current?.has(id)))
            onFiled();
          filed.current = done;
        })
        .catch((e: Error) => !stop && setError(e.message));
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [open, onFiled]);

  const submit = useCallback(() => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    void hunt
      .start(q)
      // Vidé tout de suite : monter une bibliothèque, c'est enchaîner les titres, et
      // reprendre le champ à la main entre chacun serait le geste de trop.
      .then((h) => {
        setQuery("");
        setRows((r) => [h, ...(r ?? [])]);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, [query, busy]);

  const forget = useCallback((id: string) => {
    setRows((r) => (r ?? []).filter((h) => h.id !== id));
    void hunt.forget(id).catch(() => {});
  }, []);

  const retryOnYoutube = useCallback((id: string) => {
    setError(null);
    // La ligne repasse en bleu sans attendre le tour de poll suivant : le clic doit se voir,
    // sinon on le refait.
    setRows((r) =>
      (r ?? []).map((h) =>
        h.id === id
          ? { ...h, status: "downloading", via: "youtube", error: undefined }
          : h,
      ),
    );
    void hunt.youtube(id).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Search className="mr-1 h-4 w-4" /> Trouver des morceaux
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Trouver des morceaux</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            {/* Le focus au chargement : ce dialogue n'existe que pour ce champ, et le clic
                qui l'a ouvert est déjà la demande de taper. */}
            <Input
              autoFocus
              className="h-11 flex-1 text-base"
              placeholder="artiste et titre — « nirvana lithium »"
              value={query}
              disabled={Boolean(reason)}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            <Button
              size="lg"
              onClick={submit}
              disabled={busy || !query.trim() || Boolean(reason)}
            >
              {busy ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-1 h-4 w-4" />
              )}
              Chercher
            </Button>
          </div>

          {/* Dit plutôt que caché : un déploiement pas encore configuré est son état normal,
              et un champ qui échouerait à chaque frappe n'apprendrait rien. */}
          {reason && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
              {reason}
            </p>
          )}
          {error && (
            <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {rows === null ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                chargement…
              </p>
            ) : rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Rien encore. Tapez un artiste et un titre : le morceau est
                identifié, cherché sur le réseau, puis rangé tout seul.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {rows.map((h) => (
                  <Row
                    key={h.id}
                    h={h}
                    youtube={youtube}
                    onForget={forget}
                    onYoutube={retryOnYoutube}
                  />
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
