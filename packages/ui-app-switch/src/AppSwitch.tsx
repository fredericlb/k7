// AppSwitch.tsx — the way out of one studio app and into the others: one row per app,
// minus the one drawing the menu. `serviceUrl` resolves each one's address — st0's own origin,
// z0's path under it, or pl8/k7's own subdomain; `origin` is what makes those links resolve
// against the paired SERVER instead of this tab's origin, which is the desktop app's case.
// See ../docs/appSwitch.md.

import { Button } from "@frediverse/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@frediverse/ui/dropdown-menu";
import {
  FolderGit2,
  Gamepad2,
  LayoutGrid,
  Library,
  type LucideIcon,
  Mic,
} from "@frediverse/ui/icons";
import { type StudioService, serviceUrl } from "@studio/web-protocol/services";

/** Every app of the origin, in the order they are worth reaching — the host drops its own. */
const APPS: {
  id: StudioService;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  // st0 FIRST, and it IS the reference origin every other row resolves from (../docs/appSwitch.md).
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
  // The origin every link resolves siblings FROM — the paired server if one was handed in,
  // else this tab's own, since a hosted app is no longer this menu's own origin for every row.
  const ref = origin || window.location.origin;
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
          const href = `${serviceUrl(ref, app.id)}/`;
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
