// AppSwitch.tsx — the way out of one studio app and into the others: one row per app on the
// origin, minus the one drawing the menu. Every service answers at a fixed path, so a row is a
// plain link; `origin` is what makes those links point at the paired SERVER instead of at this
// origin, which is the desktop app's case. See ../docs/appSwitch.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  SERVICE_PATHS,
  type StudioService,
  studioOrigin,
} from "@studio/web-protocol/services";
import {
  FolderGit2,
  Gamepad2,
  LayoutGrid,
  Library,
  type LucideIcon,
  Mic,
} from "lucide-react";

/** Every app of the origin, in the order they are worth reaching — the host drops its own. */
const APPS: {
  id: StudioService;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  // st0 FIRST, and it IS the origin — `SERVICE_PATHS.st0` is empty (../docs/appSwitch.md).
  {
    id: "st0",
    label: "st0",
    hint: "your projects — the repositories, the songs, the shares",
    icon: FolderGit2,
  },
  {
    id: "pl8",
    label: "pl8",
    hint: "the media library — songs, samples, takes",
    icon: Library,
  },
  {
    id: "k7",
    label: "k7",
    hint: "the rehearsal recorder — sessions, takes, tablature",
    icon: Mic,
  },
  {
    id: "z0",
    label: "z0",
    hint: "le blind-test — l'accueil du jeu",
    icon: Gamepad2,
  },
];

export interface AppSwitchProps {
  /** The app drawing the menu — the one row it never holds. */
  self: StudioService;
  /** Where the studio answers when it is not this origin: the desktop's paired server. */
  origin?: string | null;
  /** Said instead of a menu when there is nowhere to go, in the words of the app saying it. */
  unavailable?: string;
}

export function AppSwitch({ self, origin, unavailable }: AppSwitchProps) {
  // Only the origin of what was handed in: a paired server is stored as a URL, not as a host.
  const base = origin ? studioOrigin(origin) : "";
  if (unavailable)
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        aria-label="Autres applications"
        title={unavailable}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
    );
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
        {APPS.filter((app) => app.id !== self).map((app) => {
          const Icon = app.icon;
          // The trailing slash lands on the app's mount rather than on a redirect to it.
          const href = `${base}${SERVICE_PATHS[app.id]}/`;
          return (
            // asChild so the row IS the anchor, and ctrl-click and middle-click mean what they say.
            <DropdownMenuItem
              key={app.id}
              asChild
              className="items-start gap-2"
            >
              {/* Another APPLICATION: leaving this one would stop what it is playing. */}
              <a href={href} target="_blank" rel="noopener">
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
