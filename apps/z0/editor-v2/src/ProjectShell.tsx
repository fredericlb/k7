// ProjectShell.tsx — this editor's wrapper over the shared gate. The resolving, cloning and
// opening are @studio/project-shell's, exactly as st0 and m9 mount them; what belongs here is
// the wording and what to draw once the project is open.
// See packages/project-shell/docs/launch.md.

import type { RankedEngine } from "@studio/engine-browser/probe";
import { ProjectGate } from "@studio/project-shell/gate";
import type { PublicEngine } from "@studio/web-protocol";
import { Session } from "./Session";

export function ProjectShell({
  engine,
}: {
  engine: RankedEngine<PublicEngine>;
}) {
  return (
    <ProjectGate
      engine={engine}
      app="z0"
      // The same two the router's basename is built from, in main.tsx.
      base={import.meta.env.BASE_URL}
      strings={{
        cloning: (workspace) =>
          `Récupération de ${workspace} sur cette machine…`,
        back: "Retour aux projets",
        retry: "Réessayer",
        unreachableTitle: "Impossible d'accéder aux fichiers de ce moteur",
        unreachableBody: (base) =>
          `Le service de fichiers de ce moteur (${base}) n'a pas répondu. Il est peut-être arrêté.`,
        blockedTitle: "Cette page n'est pas autorisée à joindre le moteur",
        blockedBody: (origin) =>
          `Le service de fichiers tourne, mais il a refusé l'origine de cette page (${origin}). Autorisez-la depuis le capot : « Web UI ▸ ${origin} », puis réessayez.`,
        bothBody:
          "Le service de fichiers du moteur n'a pas répondu. Il est peut-être arrêté, ou l'origine de cette page n'est peut-être pas autorisée à l'appeler.",
        missingTitle: "Cette session n'est pas dans le dépôt",
        missingBody:
          "Le dépôt est bien là, mais pas ce dossier .z0 : il a sans doute été renommé ou supprimé depuis la dernière lecture du dépôt par la médiathèque. Retournez aux projets et rouvrez-le.",
        librariesTitle: "Aucun dépôt de bibliothèques",
        librariesBody:
          "Les modules et les chaînes partagés vivent dans un dépôt git, monté dans chaque espace de travail. Votre compte n'en a pas encore, donc rien ne peut résoudre un module partagé. Ajoutez-le en haut de la section Projets de la médiathèque, puis rouvrez ceci.",
      }}
    >
      {({ project, quit }) => (
        <Session key={project} project={project} quit={quit} />
      )}
    </ProjectGate>
  );
}
