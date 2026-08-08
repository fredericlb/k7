// ProjectShell.tsx — v1's wrapper over the shared gate. The resolving, cloning and opening are
// @studio/project-shell's (l8 and m9 mount the same thing); what belongs here is the wording and
// what to render once the project is open. See @studio/project-shell docs/launch.md.

import type { RankedEngine } from "@studio/engine-browser/probe";
import { ProjectGate } from "@studio/project-shell/gate";
import type { PublicEngine } from "@studio/web-protocol";
import { Studio } from "./Studio";

export function ProjectShell({
  engine,
}: {
  engine: RankedEngine<PublicEngine>;
}) {
  return (
    <ProjectGate
      engine={engine}
      app="v1"
      // The same two the router's basename is built from, in main.tsx.
      base={import.meta.env.BASE_URL}
      strings={{
        cloning: (workspace) =>
          `Récupération de ${workspace} sur cette machine…`,
        back: "Retour aux projets",
        retry: "Réessayer",
        unreachableTitle: "Impossible d'accéder aux fichiers de cette machine",
        unreachableBody: (base) =>
          `Le service de fichiers de cette machine (${base}) n'a pas répondu. Il est peut-être arrêté.`,
        blockedTitle: "Cette page n'est pas autorisée à joindre la machine",
        blockedBody: (origin) =>
          `Le service de fichiers tourne, mais il a refusé l'origine de cette page (${origin}). Autorisez-la depuis le capot : « Web UI ▸ ${origin} », puis réessayez.`,
        bothBody:
          "Le service de fichiers de la machine n'a pas répondu. Il est peut-être arrêté, ou l'origine de cette page n'est peut-être pas autorisée à l'appeler.",
        missingTitle: "Ce montage n'est pas dans le dépôt",
        missingBody:
          "Le dépôt est bien là, mais pas ce montage : il a sans doute été renommé ou supprimé depuis la dernière lecture du dépôt par la médiathèque. Retournez aux projets et rouvrez-le.",
      }}
    >
      {({ project, quit }) => (
        // Keyed on the project so switching between two in one repository remounts cleanly.
        <Studio key={project} project={project} quit={quit} />
      )}
    </ProjectGate>
  );
}
