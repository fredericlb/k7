// LazyYamlPane.tsx — `@studio/ui-editor`'s YamlPane, fetched as its own chunk when a screen first
// draws one, so CodeMirror stays out of the app's first parse (docs/shell.md).

import type { YamlPane as YamlPaneView } from "@studio/ui-editor/yaml-pane";
import { type ComponentProps, lazy, Suspense } from "react";

const View = lazy(() =>
  import("@studio/ui-editor/yaml-pane").then((m) => ({ default: m.YamlPane })),
);

export function YamlPane(props: ComponentProps<typeof YamlPaneView>) {
  return (
    <Suspense fallback={null}>
      <View {...props} />
    </Suspense>
  );
}
