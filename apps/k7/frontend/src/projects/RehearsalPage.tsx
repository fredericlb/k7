// RehearsalPage.tsx — `/rehearsal/…`, the rehearsal pages inside the home's frame: the sections are
// entries of the sidebar, the screens are a lazy chunk, and the take's red dot is the home's own
// control (HomeFrame.tsx), so it stays in the sidebar on every page. The take itself is held above
// the routes (appMain.tsx), so it outlives this page.

import { Loader2 } from "@frediverse/ui/icons";
import { lazy, Suspense } from "react";
import { HomeShell } from "./HomeFrame";

const RehearsalRoutes = lazy(() =>
  import("@studio/ui-rehearsal/pages").then((x) => ({
    default: x.RehearsalRoutes,
  })),
);

export function RehearsalPage() {
  return (
    <HomeShell>
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
