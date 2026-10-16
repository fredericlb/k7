// UserMenu.tsx — studio's user menu: @frediverse/ui's, with one link per OTHER studio app of the
// origin. `serviceUrl` resolves each one's address — k7's own origin or z0's path under it;
// `origin` makes those links resolve against the paired SERVER instead of this tab's origin,
// which is the desktop app's case. See ../docs/userMenu.md.

import { FolderGit2, Gamepad2, type LucideIcon } from "@frediverse/ui/icons";
import {
  UserMenu as BaseUserMenu,
  type UserMenuItem,
} from "@frediverse/ui/user-menu";
import { type StudioService, serviceUrl } from "@studio/web-protocol/services";

/** Every app of the origin, in the order they are worth reaching — the host drops its own. */
const APPS: {
  id: StudioService;
  label: string;
  hint: string;
  icon: LucideIcon;
}[] = [
  // k7 FIRST, and it IS the reference origin every other row resolves from (../docs/userMenu.md).
  {
    id: "k7",
    label: "k7",
    hint: "your projects, the media library, the rehearsals, the shares",
    icon: FolderGit2,
  },
  {
    id: "z0",
    label: "z0",
    hint: "le blind-test — l'accueil du jeu",
    icon: Gamepad2,
  },
];

export interface UserMenuProps {
  /** The app drawing the menu — the one row it never holds. */
  self: StudioService;
  /** Who is signed in, as the menu's heading; null while it is not known yet. */
  email?: string | null;
  /** Ends the session — the host's own call, since each app reaches /auth from a different origin. */
  onLogout: () => void;
  /** Opens the host's settings page, the row under the email — the host's own navigation. */
  onSettings?: () => void;
  /** That row's name, in the host's language. */
  settingsLabel?: string;
  /** More of the host's own pages, as rows under Settings — the desktop's engine, say. */
  items?: UserMenuItem[];
  /** Where the studio answers when it is not this origin: the desktop's paired server. */
  origin?: string | null;
  /** Said in place of the app rows when there is nowhere to go, in the words of the app saying it. */
  unavailable?: string;
}

export function UserMenu({
  self,
  email,
  onLogout,
  onSettings,
  settingsLabel,
  items,
  origin,
  unavailable,
}: UserMenuProps) {
  // The origin every link resolves siblings FROM: the paired server if one was handed in, else this tab's.
  const ref = origin || window.location.origin;
  const links = APPS.filter((app) => app.id !== self).map((app) => ({
    ...app,
    // The trailing slash lands on the app's mount rather than on a redirect to it.
    href: `${serviceUrl(ref, app.id)}/`,
  }));
  return (
    <BaseUserMenu
      email={email}
      onLogout={onLogout}
      onSettings={onSettings}
      settingsLabel={settingsLabel}
      items={items}
      links={links}
      notice={unavailable}
    />
  );
}
