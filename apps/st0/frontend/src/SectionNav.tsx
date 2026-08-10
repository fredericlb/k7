// SectionNav.tsx — les sections de st0, dans les deux formes que l'écran demande : une bande
// d'onglets quand il y a la place, un menu hamburger quand il n'y en a pas. Une seule liste,
// pour que les deux ne puissent pas diverger. Voir ../docs/responsive.md.

import { Button } from "@frediverse/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@frediverse/ui/sheet";
import { RECORDINGS_DIR } from "@studio/mediatek/types";
import {
  Boxes,
  Disc3,
  FolderGit2,
  ListMusic,
  type LucideIcon,
  Menu,
  Mic,
  Waves,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { PROJECTS_SECTION, type SectionId } from "./routes";

/**
 * Les sections : les dépôts, puis les cinq familles et la zone de captures brutes.
 *
 * PROJETS ouvre la marche parce que c'est là que l'app démarre (`DEFAULT_SECTION`), et une
 * bande d'onglets dont le premier n'est pas l'écran d'accueil se lit comme une erreur. C'est
 * aussi la section la plus éloignée du volume : elle n'est pas dessus du tout — un dépôt
 * appartient à une personne, ce service n'en fait jamais de copie de travail, et son listing
 * vient de `/api/projects` et non du catalogue. Voir ../../docs/projects.md.
 *
 * ENREGISTREMENTS n'est pas une famille non plus — c'est un dossier à la racine, sans entrée
 * de catalogue et sans listing à demander à `/list`. Il est ici parce que l'écran s'organise
 * par ce qu'on regarde, et ce qu'on regarde est une cinquième chose.
 * Voir packages/mediatek/docs/recordings.md.
 */
export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: PROJECTS_SECTION, label: "Projets", icon: FolderGit2 },
  { id: "songs", label: "Morceaux", icon: Disc3 },
  { id: "samples", label: "Samples", icon: Waves },
  { id: "modules", label: "Modules", icon: Boxes },
  { id: "chains", label: "Chaînes", icon: Workflow },
  { id: "playlists", label: "Playlists", icon: ListMusic },
  { id: RECORDINGS_DIR, label: "Enregistrements", icon: Mic },
];

/** Ce que porte une ligne, quelle que soit la forme : l'icône, le nom, et combien il y en a. */
function Row({
  label,
  Icon,
  count,
  active,
}: {
  label: string;
  Icon: LucideIcon;
  count: number;
  active: boolean;
}) {
  return (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span
        className={`shrink-0 tabular-nums text-xs ${active ? "" : "text-muted-foreground"}`}
      >
        {count}
      </span>
    </>
  );
}

export function SectionNav({
  section,
  counts,
  onPick,
}: {
  section: SectionId;
  counts: Partial<Record<string, number>>;
  onPick: (id: SectionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const here = SECTIONS.find((s) => s.id === section);

  return (
    <>
      {/* Étroit : le hamburger, et le nom de la section À CÔTÉ. Un hamburger seul ne dit pas
          où l'on est, et c'est la première chose qu'on demande à un écran de téléphone. */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            aria-label="Sections"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 p-0">
          <SheetHeader className="border-b p-4">
            <SheetTitle>Sections</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col p-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                // Le menu se referme sur le choix : il recouvre l'écran, et le laisser ouvert
                // cacherait exactement ce qu'on vient de demander à voir.
                onClick={() => {
                  onPick(id);
                  setOpen(false);
                }}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${
                  section === id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50"
                }`}
              >
                <Row
                  label={label}
                  Icon={Icon}
                  count={counts[id] ?? 0}
                  active={section === id}
                />
              </button>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
      {here ? (
        <span className="truncate text-sm font-medium md:hidden">
          {here.label}
        </span>
      ) : null}

      {/* Large : la bande d'onglets, telle qu'elle a toujours été. */}
      <nav className="hidden items-center gap-1 md:flex">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            // Rien à vider ici : changer de section suffit, et l'effet qui suit `section`
            // s'en charge — y compris quand c'est le bouton « précédent » ou un lien profond
            // qui en change, ce que ce gestionnaire ne voit pas.
            onClick={() => onPick(id)}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
              section === id
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            <Row
              label={label}
              Icon={Icon}
              count={counts[id] ?? 0}
              active={section === id}
            />
          </button>
        ))}
      </nav>
    </>
  );
}
