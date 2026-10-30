// EditorPane.tsx — the code editor, loaded as its own chunk and mounted the first time its pane is
// on screen (paneVisible.ts). The one thing a reader would get wrong: once mounted it stays mounted,
// hidden or not, so the undo history survives as the pane invariant asks; the chunk is also fetched
// at idle, so the first show rarely waits (docs/shell.md).

import {
  type ComponentProps,
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";
import { usePaneVisible } from "../paneVisible";
import type EditorPaneView from "./EditorPaneView";

const loadView = () => import("./EditorPaneView");
const View = lazy(loadView);

let prefetched = false;
/** Fetch and parse the chunk when the page is idle, once per page. */
function prefetchView() {
  if (prefetched) return;
  prefetched = true;
  const go = () => void loadView();
  if (typeof requestIdleCallback === "function")
    requestIdleCallback(go, { timeout: 5000 });
  else setTimeout(go, 2000);
}

export function EditorPane(props: ComponentProps<typeof EditorPaneView>) {
  const visible = usePaneVisible();
  const [shown, setShown] = useState(visible);
  useEffect(() => {
    if (visible) setShown(true);
  }, [visible]);
  useEffect(prefetchView, []);
  if (!shown) return null;
  return (
    <Suspense fallback={null}>
      <View {...props} />
    </Suspense>
  );
}
