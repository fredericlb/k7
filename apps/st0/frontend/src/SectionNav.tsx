// SectionNav.tsx — les sections de st0, en `AppHeaderItem` : la bande d'onglets et le menu
// hamburger sont ceux de @frediverse/ui, cette liste est celle de st0. Le compte de chaque
// section voyage sur le `trailing` de l'item. Voir ../docs/responsive.md.

import type { AppHeaderItem } from "@frediverse/ui/app-header";
import { RECORDINGS_DIR } from "@studio/mediatek/types";
import {
  Boxes,
  Disc3,
  FolderGit2,
  ListMusic,
  type LucideIcon,
  Mic,
  Waves,
  Workflow,
} from "lucide-react";
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

/**
 * Les sections, dans la forme que la barre partagée consomme.
 *
 * Le COMPTE part sur `trailing` et non dans le libellé : le libellé est la chaîne que le menu
 * coche et qu'`aria-current` annonce, et un nombre fondu dedans serait lu comme une partie du nom
 * de la page — et changerait à chaque fois que le catalogue change. Atténué et tabulaire, comme il
 * l'a toujours été.
 *
 * Une fonction et non un tableau : `counts` et `section` changent, la liste non.
 */
export function sectionItems(
  section: SectionId,
  counts: Partial<Record<string, number>>,
  onPick: (id: SectionId) => void,
): AppHeaderItem[] {
  return SECTIONS.map(({ id, label, icon: Icon }) => ({
    label,
    icon: <Icon className="h-4 w-4 shrink-0" />,
    active: section === id,
    onClick: () => onPick(id),
    trailing: (
      <span
        className={`shrink-0 tabular-nums text-xs ${
          section === id ? "" : "text-muted-foreground"
        }`}
      >
        {counts[id] ?? 0}
      </span>
    ),
  }));
}

/** Le nom de la section où l'on est — ce que la barre met en sous-titre. Un hamburger seul ne dit
 *  pas où l'on est, et c'est la première chose qu'on demande à un écran de téléphone. */
export const sectionLabel = (section: SectionId): string | undefined =>
  SECTIONS.find((s) => s.id === section)?.label;
