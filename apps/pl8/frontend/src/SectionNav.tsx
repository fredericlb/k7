// SectionNav.tsx — les sections de pl8, en `AppHeaderItem` : la bande d'onglets et le menu
// hamburger sont ceux de @frediverse/ui, cette liste est celle de pl8. Le compte de chaque
// section voyage sur le `trailing` de l'item. Voir ../docs/responsive.md.

import type { AppHeaderItem } from "@frediverse/ui/app-header";
import { RECORDINGS_DIR } from "@studio/mediatek/types";
import { Disc3, type LucideIcon, Mic, Waves } from "lucide-react";
import type { SectionId } from "./routes";

/**
 * Les sections : les trois familles, et la zone de captures brutes.
 *
 * TROIS sont parties ensemble, et pour une seule raison : elles parlaient d'ÉCRITURE, et on
 * écrit dans st0.
 *
 * MODULES et CHAÎNES sont parties avec l'édition : un module s'écrit contre un projet où le
 * greffon qu'il nomme est réellement CHARGÉ, et se committe dans le dépôt de bibliothèques du
 * compte. Ce volume n'en tient plus aucun.
 *
 * PROJETS ouvrait la marche, et l'app y démarrait. Les dépôts sont la page d'accueil de st0
 * maintenant — c'était la section la plus éloignée de ce volume, la seule qui n'était pas
 * dessus du tout, et le niveau au-dessus d'un projet appartient à l'éditeur qui en ouvre un.
 * Les routes, elles, n'ont pas bougé d'ici. Voir apps/st0/frontend/docs/projects.md.
 *
 * ENREGISTREMENTS n'est pas une famille non plus — c'est un dossier à la racine, sans entrée
 * de catalogue et sans listing à demander à `/list`. Il est ici parce que l'écran s'organise
 * par ce qu'on regarde, et ce qu'on regarde est une chose de plus.
 * Voir packages/mediatek/docs/recordings.md.
 */
export const SECTIONS: { id: SectionId; label: string; icon: LucideIcon }[] = [
  { id: "songs", label: "Morceaux", icon: Disc3 },
  { id: "samples", label: "Samples", icon: Waves },
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
