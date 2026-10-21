// RehearsalPage.tsx — `/rehearsal/…`, the rehearsal pages inside the home's frame: the sections are
// entries of the sidebar, the red dot that starts a take is the page's action, and the screens are
// a lazy chunk. The take itself is held above the routes (appMain.tsx), so it outlives this page.

import { Loader2 } from "@frediverse/ui/icons";
import { NewSessionButton } from "@studio/ui-rehearsal";
import { lazy, Suspense } from "react";
import { HomeShell } from "./HomeSidebar";

const RehearsalRoutes = lazy(() =>
  import("@studio/ui-rehearsal/pages").then((x) => ({
    default: x.RehearsalRoutes,
  })),
);

export function RehearsalPage() {
  return (
    <HomeShell actions={<NewSessionButton />}>
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
