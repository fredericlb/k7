// lazyDrawer.tsx — a surface's drawer whose code is fetched the first time it is mounted. The
// plugin's metadata stays in the shell's chunk; the desk and the compositor do not, since a
// project that declares neither should not download them. The Suspense is the drawer's own, so
// a drawer arriving never hides the panes around it, and a mounted drawer never suspends again —
// the pane invariant (mounted once, hidden, never unmounted) holds. See ../docs/plugins.md.

import { Loader2 } from "@frediverse/ui/icons";
import { type ComponentType, lazy, type ReactNode, Suspense } from "react";

export function lazyDrawer<P extends object>(
  load: () => Promise<ComponentType<P>>,
): (props: P) => ReactNode {
  const Drawer = lazy(() => load().then((c) => ({ default: c })));
  // A named function, so React's devtools and error stacks say which drawer it is.
  return function LazyDrawer(props: P) {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <Drawer {...props} />
      </Suspense>
    );
  };
}
