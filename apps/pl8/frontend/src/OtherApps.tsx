// OtherApps.tsx — the header's app switcher: the studio's other front doors — st0's projects,
// k7, z0. Every service is a fixed path on ONE origin, so all three are plain same-origin paths
// and a link is the whole navigation — one that opens a NEW TAB. See ../../docs/otherApps.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import { SERVICE_PATHS } from "@studio/web-protocol/services";
import {
  FolderGit2,
  Gamepad2,
  LayoutGrid,
  type LucideIcon,
  Mic,
} from "lucide-react";

/** The apps reachable from here, in the order they are worth reaching. */
const OTHER_APPS: {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  // st0 FIRST, and it is now the ORIGIN ITSELF: `SERVICE_PATHS.st0` is the empty string, so this
  // href is `/`. It was absent from this menu for a long time — an editor opened on one project
  // is not a place you visit, and a bare `/st0` landed on an app with nothing to open. Then it
  // gained a home page (the repositories, which used to be a section HERE), and that page is
  // what the studio opens on now. This entry is the way BACK to it; the way here is the pl8
  // button in that page's header. See ../../docs/otherApps.md.
  {
    href: `${SERVICE_PATHS.st0}/`,
    label: "st0",
    hint: "vos projets — les dépôts, les morceaux, les partages",
    icon: FolderGit2,
  },
  {
    href: `${SERVICE_PATHS.k7}/`,
    label: "k7",
    hint: "l'enregistreur de répétitions — sessions, prises, tablature",
    icon: Mic,
  },
  // z0 runs its own login on its own /z0/auth/callback, so it is not one of the services that
  // share pl8's session — but its PATH is as fixed as the others', which is what the table says.
  {
    href: `${SERVICE_PATHS.z0}/`,
    label: "z0",
    hint: "le blind-test — l'accueil du jeu",
    icon: Gamepad2,
  },
];

export function OtherApps() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Autres applications"
          title="Autres applications"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Autres applications</DropdownMenuLabel>
        {OTHER_APPS.map((app) => {
          const Icon = app.icon;
          return (
            // asChild so the row IS the anchor: ctrl-click, middle-click and "copy link
            // address" all mean what they say, and `target` is then the only thing to set.
            <DropdownMenuItem
              key={app.href}
              asChild
              className="items-start gap-2"
            >
              {/* Another APPLICATION, not another page of this one: the médiathèque is what
                  you were doing before and after, and leaving would stop what it is playing. */}
              <a href={app.href} target="_blank" rel="noopener">
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block">{app.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {app.hint}
                  </span>
                </span>
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
