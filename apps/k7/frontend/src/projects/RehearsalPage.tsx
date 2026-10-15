// RehearsalPage.tsx — `/rehearsal/…`, the rehearsal pages inside the home's frame: the sections are
// entries of the sidebar, the red dot that starts a take is the page's action, and the screens are
// a lazy chunk. The take itself is held above the routes (appMain.tsx), so it outlives this page.

import { Loader2 } from "@frediverse/ui/icons";
import {
  NewSessionButton,
  REHEARSAL_SECTIONS,
  rehearsalSectionAt,
} from "@studio/ui-rehearsal";
import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import { m } from "../paraglide/messages.js";
import { REHEARSAL_ROUTE } from "./api";
import { HomeShell } from "./HomeSidebar";

const RehearsalRoutes = lazy(() =>
  import("@studio/ui-rehearsal/pages").then((x) => ({
    default: x.RehearsalRoutes,
  })),
);

export function RehearsalPage() {
  const { pathname } = useLocation();
  const id = rehearsalSectionAt(pathname, REHEARSAL_ROUTE);
  const section = REHEARSAL_SECTIONS.find((s) => s.id === id);
  return (
    <HomeShell
      subtitle={section?.label() ?? m["home.rehearsal"]()}
      actions={<NewSessionButton />}
    >
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <RehearsalRoutes />
      </Suspense>
    </HomeShell>
  );
}
